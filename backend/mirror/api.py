"""API web (FastAPI). En local : `uvicorn mirror.api:app --app-dir backend --port 8000`.

Deux familles de routes :
  /api/...  application web (profil, simulation, révélation, pacte, tableau de bord)
  /v1/...   API d'intégration pour la plateforme hôte (clé d'API dans l'en-tête X-Api-Key)
Sur AWS, Kiro expose les mêmes routes derrière API Gateway + Lambda (docs/KIRO_PROMPTS.md).
"""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .service import ROOT, Conflict, MirrorService, NotFound, build_local_service


def make_service() -> MirrorService:
    if os.environ.get("MIRROR_ENV", "local") == "aws":
        from .adapters_aws import build_aws_service
        return build_aws_service()
    return build_local_service(persist=os.environ.get("MIRROR_PERSIST") or None, sync_bus=False)


app = FastAPI(title="AlphaForge Mirror", version="0.1.0",
              description="SIMULATION uniquement. Ne constitue pas un conseil financier. Aucun ordre n'est exécuté.")
svc = make_service()
API_KEY = os.environ.get("MIRROR_API_KEY", "dev-host-key")


@app.exception_handler(NotFound)
async def _nf(_: Request, e: NotFound):
    return JSONResponse({"erreur": str(e)}, status_code=404)


@app.exception_handler(Conflict)
async def _cf(_: Request, e: Conflict):
    return JSONResponse({"erreur": str(e)}, status_code=409)


@app.exception_handler(ValueError)
async def _ve(_: Request, e: ValueError):
    return JSONResponse({"erreur": str(e)}, status_code=422)


def host_auth(x_api_key: str | None = Header(default=None)):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Clé d'API absente ou invalide.")


# ------------------------------------------------------------------ modèles d'entrée
class NewUser(BaseModel):
    persona: str | None = None
    custom: dict | None = None


class NewSession(BaseModel):
    user_id: str
    mode: str = "complet"
    targets: list[str] | None = None


class Decision(BaseModel):
    action: str
    decision_time_ms: int = Field(ge=0)
    hesitations: int = 0


class Recognition(BaseModel):
    answer: str


class RuleText(BaseModel):
    text: str
    trait: str | None = None
    strictness: int = Field(default=1, ge=1, le=3)
    replaces: str | None = None


class Consent(BaseModel):
    platform: str
    granted: bool


class TradeEvent(BaseModel, extra="allow"):
    event_id: str
    user_id: str
    executed_at: str
    side: str
    symbol: str
    amount: float
    amount_currency: str = "CAD"


class TradeIntent(BaseModel, extra="allow"):
    user_id: str
    side: str
    symbol: str
    amount: float
    amount_currency: str = "CAD"


class Webhook(BaseModel):
    url: str | None = None
    secret: str | None = None


# ------------------------------------------------------------------ application web
@app.get("/api/health")
def health():
    return {"ok": True, "simulation": True, "modele": svc.model.name, "episodes": len(svc.library.episodes)}


@app.get("/api/personas")
def personas():
    return svc.personas()


@app.post("/api/users")
def create_user(body: NewUser):
    u = svc.create_user(body.persona, body.custom)
    return {"user_id": u["user_id"], "declared": u["declared"], "link_code": u["link_code"]}


@app.get("/api/users/{uid}")
def get_user(uid: str):
    u = svc.user(uid)
    has_profile = svc.repo.get("profiles", uid) is not None
    return {"user_id": uid, "declared": u["declared"], "link_code": u["link_code"], "has_profile": has_profile,
            "last_session": u["sessions"][-1] if u["sessions"] else None}


@app.get("/api/users/{uid}/sources")
def sources(uid: str):
    return svc.sources(uid)


@app.put("/api/users/{uid}/sources")
def set_source(uid: str, body: Consent):
    return svc.set_source(uid, body.platform, body.granted)


@app.post("/api/sessions")
def start_session(body: NewSession):
    return svc.start_session(body.user_id, body.mode, body.targets)


@app.get("/api/sessions/{sid}")
def current(sid: str):
    return svc.current(sid)


@app.post("/api/sessions/{sid}/decisions")
def decide(sid: str, body: Decision):
    return svc.decide(sid, body.action, body.decision_time_ms, body.hesitations)


@app.post("/api/sessions/{sid}/recognition")
def recognition(sid: str, body: Recognition):
    return svc.recognition(sid, body.answer)


@app.get("/api/sessions/{sid}/reveal")
def reveal(sid: str):
    return svc.reveal_of(sid)


@app.get("/api/users/{uid}/profile")
def profile(uid: str):
    return svc.profile(uid)


@app.get("/api/users/{uid}/timeline")
def timeline(uid: str):
    return svc.timeline(uid)


@app.get("/api/users/{uid}/trades")
def trades(uid: str):
    return svc.trades(uid)


@app.get("/api/users/{uid}/evidence/{eid}")
def evidence(uid: str, eid: str):
    return svc.evidence(uid, eid)


@app.get("/api/users/{uid}/investigations/{event_id}")
def investigation_ui(uid: str, event_id: str):
    return svc.investigation(event_id)


@app.get("/api/users/{uid}/reminders/{gid}")
def reminder(uid: str, gid: str):
    return svc.guard_decision(uid, gid)


@app.post("/api/users/{uid}/rules/parse")
def parse_rule(uid: str, body: RuleText):
    return svc.parse_rule(uid, body.text, body.trait)


@app.post("/api/users/{uid}/rules")
def confirm_rule(uid: str, body: RuleText):
    return svc.confirm_rule(uid, body.text, body.trait, body.strictness, body.replaces)


@app.post("/api/users/{uid}/rules/refuse")
def refuse_rule(uid: str, body: RuleText):
    return svc.refuse_rule(uid, body.trait or "")


@app.get("/api/users/{uid}/webhooks")
def deliveries(uid: str):
    return svc.webhook_deliveries(uid)


# ------------------------------------------------------------------ API d'intégration (hôte)
@app.post("/v1/trade-events", status_code=202, dependencies=[Depends(host_auth)])
def trade_events(ev: TradeEvent):
    return svc.ingest_trade_event(ev.model_dump())


@app.get("/v1/trade-events/{event_id}", dependencies=[Depends(host_auth)])
def trade_result(event_id: str):
    return svc.trade_result(event_id)


@app.get("/v1/trade-events/{event_id}/investigation", dependencies=[Depends(host_auth)])
def investigation(event_id: str):
    return svc.investigation(event_id)


@app.post("/v1/trade-intents:check", dependencies=[Depends(host_auth)])
def trade_intent(intent: TradeIntent):
    return svc.check_intent(intent.model_dump())


@app.get("/v1/users/{uid}/profile", dependencies=[Depends(host_auth)])
def v1_profile(uid: str):
    p = svc.profile(uid)
    return {"user_id": uid, "version": p["version"], "derive": p["derive"], "resume": p["resume"],
            "traits": {k: {x: t[x] for x in ("declared", "observed", "low", "high", "confidence")} for k, t in p["traits"].items()}}


@app.get("/v1/users/{uid}/timeline", dependencies=[Depends(host_auth)])
def v1_timeline(uid: str):
    return svc.timeline(uid)


@app.get("/v1/users/{uid}/rules", dependencies=[Depends(host_auth)])
def v1_rules(uid: str):
    return svc.rules_of(uid)


@app.put("/v1/users/{uid}/sources", dependencies=[Depends(host_auth)])
def v1_sources(uid: str, body: Consent):
    return svc.set_source(uid, body.platform, body.granted)


@app.delete("/v1/users/{uid}/sources/{platform}", dependencies=[Depends(host_auth)])
def v1_revoke(uid: str, platform: str):
    return svc.set_source(uid, platform, False)


@app.get("/v1/evidence/{eid}", dependencies=[Depends(host_auth)])
def v1_evidence(eid: str, user_id: str):
    return svc.evidence(user_id, eid)


@app.put("/v1/webhooks", dependencies=[Depends(host_auth)])
def v1_webhooks(body: Webhook):
    w = svc.register_webhook(body.url, body.secret)
    return {"url": w["url"], "registered_at": w["registered_at"], "signature": "HMAC-SHA256, en-tête X-Mirror-Signature"}


# ------------------------------------------------------------------ application web statique
DIST = Path(os.environ.get("MIRROR_FRONTEND", ROOT / "frontend" / "dist"))
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/")
    def index():
        return FileResponse(DIST / "index.html")
