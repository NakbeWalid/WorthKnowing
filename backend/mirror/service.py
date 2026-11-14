"""Cas d'usage : assemble le cœur et les ports. Aucune dépendance au cadre web ni à AWS."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import threading
import uuid
from pathlib import Path

import yaml

from . import posttrade, reveal, rules, scoring
from .scenarios import Director, EpisodeLibrary
from .simulation import SimulationEngine, now_iso

ROOT = Path(__file__).resolve().parents[2]


def load_config(config_dir: str | Path | None = None) -> dict:
    d = Path(config_dir or ROOT / "config")
    return {p.stem: yaml.safe_load(p.read_text(encoding="utf-8")) for p in sorted(d.glob("*.yaml"))}


class NotFound(Exception):
    pass


class Conflict(Exception):
    pass


class MirrorService:
    def __init__(self, cfg, repo, market, library, model, bus, news, social, webhook_sender=None):
        self.cfg, self.repo, self.market, self.library = cfg, repo, market, library
        self.model, self.bus, self.news, self.social, self.sender = model, bus, news, social, webhook_sender
        use_model = model if getattr(model, "name", "") != "gabarits-locaux" else None
        self.llm = use_model
        self.engine = SimulationEngine(repo, library, market, Director(library, use_model), cfg, use_model)
        bus.subscribe("trade.received", self._process_trade)

    # ================================================================== profils déclarés
    def personas(self) -> list[dict]:
        return [{"id": k, **v} for k, v in self.cfg["allocations"]["personas"].items()]

    def create_user(self, persona: str | None, custom: dict | None = None) -> dict:
        if persona:
            p = self.cfg["allocations"]["personas"].get(persona)
            if not p:
                raise NotFound("Persona inconnu.")
            declared = {**p, "persona": persona}
        else:
            c = custom or {}
            if c.get("risque") not in self.cfg["scoring"]["declared_drawdown_threshold_pct"]:
                raise ValueError("Niveau de risque invalide.")
            declared = {"persona": None, "nom": c.get("nom") or "Profil personnalisé", "risque": c["risque"],
                        "horizon_ans": int(c.get("horizon_ans", 10)), "esg": bool(c.get("esg")),
                        "exclusions": ["Energy"] if c.get("esg") else [], "crypto": bool(c.get("crypto")),
                        "experience": c.get("experience", "intermediaire"),
                        "auto_evaluation": {k: int(min(5, max(1, (c.get("auto_evaluation") or {}).get(k, 3))))
                                            for k in scoring.SELF_ITEMS},
                        "allocation": {"Portefeuille fictif selon ton profil": 90, "Liquidités": 10}}
        uid = f"{persona or 'profil'}-{uuid.uuid4().hex[:6]}"
        user = {"user_id": uid, "declared": declared, "created_at": now_iso(), "link_code": uuid.uuid4().hex[:6].upper(),
                "used_episodes": [], "consents": {}, "trait_adjustments": {}, "weakness_status": {},
                "drift": None, "sessions": []}
        self.repo.put("users", uid, user)
        return user

    def user(self, user_id: str) -> dict:
        u = self.repo.get("users", user_id)
        if not u:
            raise NotFound("Utilisateur inconnu.")
        return u

    # ================================================================== consentements
    def sources(self, user_id: str) -> dict:
        u = self.user(user_id)
        return {"plateformes": [{"id": p, "couverture": self.social.coverage(p), **u["consents"].get(p, {"granted": False})}
                                for p in self.social.platforms],
                "conservation_jours": self.cfg["investigation"]["retention_days"],
                "note": "Dans cette démonstration, les comptes liés sont fictifs (jeu de données synthétique)."}

    def set_source(self, user_id: str, platform: str, granted: bool) -> dict:
        u = self.user(user_id)
        if platform not in self.social.platforms:
            raise NotFound("Plateforme inconnue.")
        if granted:
            u["consents"][platform] = {"granted": True, "granted_at": now_iso()}
        else:  # révocation : on retire le consentement et les signaux dérivés de ce compte
            u["consents"][platform] = {"granted": False, "revoked_at": now_iso()}
            for inv in self.repo.list("investigations", user_id + "/"):
                inv["signals"] = [s for s in inv["signals"] if not s["source"].startswith(platform)]
                self.repo.put("investigations", f"{user_id}/{inv['trade_id']}", inv)
        self.repo.put("consent_log", f"{user_id}/{now_iso()}/{platform}", {"platform": platform, "granted": granted, "at": now_iso()})
        self.repo.put("users", user_id, u)
        return self.sources(user_id)

    # ================================================================== simulation
    def start_session(self, user_id: str, mode: str = "complet", targets: list[str] | None = None, seed: str | None = None) -> dict:
        u = self.user(user_id)
        if mode not in ("complet", "demo", "cible"):
            raise ValueError("Mode inconnu.")
        if mode == "cible" and not targets:
            targets = self._degraded_traits(u)
        s = self.engine.start(u, mode, targets, seed)
        u["sessions"].append(s["session_id"])
        self.repo.put("users", user_id, u)
        return self.engine.view(s, u["declared"])

    def _session(self, session_id: str) -> tuple[dict, dict]:
        s = self.repo.get("sessions", session_id)
        if not s:
            raise NotFound("Session inconnue.")
        return s, self.user(s["user_id"])

    def current(self, session_id: str) -> dict:
        s, u = self._session(session_id)
        return self.engine.view(s, u["declared"])

    def decide(self, session_id: str, action: str, decision_time_ms: int, hesitations: int = 0) -> dict:
        s, u = self._session(session_id)
        self.engine.decide(s, u["declared"], action, decision_time_ms, hesitations)
        return self.engine.view(s, u["declared"])  # aucune information sur le résultat de la décision

    def recognition(self, session_id: str, answer: str) -> dict:
        s, u = self._session(session_id)
        self.engine.recognition(s, u["declared"], answer)
        if s["status"] == "finished":
            self._finalize(s, u)
        return self.engine.view(s, u["declared"])

    # ------------------------------------------------------------------ fin de session
    def _all_decisions(self, u: dict) -> list[dict]:
        out = []
        for sid in u["sessions"]:
            s = self.repo.get("sessions", sid)
            if s and s["status"] == "finished":
                out += s["decisions"]
        return out

    def _put_evidence(self, user_id: str, items: list[dict]) -> None:
        for e in items:
            self.repo.put("evidence", f"{user_id}/{e['id']}", e)

    def _finalize(self, s: dict, u: dict) -> None:
        declared = u["declared"]
        scen, ev = reveal.build_reveal(s, declared, self.library, self.market, self.cfg, self.engine.v0)
        self._put_evidence(u["user_id"], ev)
        by_id = {e["id"]: e for e in ev}
        traces = []
        for sc in scen:
            sc["phrases"], tr = reveal.explain("révélation", {"scenario": sc["scenario_id"], "preuves": [by_id[i] for i in sc["evidence_ids"]]},
                                               sc["phrases"], by_id, self.llm)
            traces.append(tr)
        self.repo.put("reveals", s["session_id"], {"session_id": s["session_id"], "scenarios": scen, "traces": traces,
                                                    "directeur": s["director_trace"]})
        u["used_episodes"] = sorted(set(u["used_episodes"]) | {sc["episode_id"] for sc in s["scenarios"]})
        cause = "Réévaluation ciblée" if s["mode"] == "cible" else "Simulation initiale"
        if u["drift"] is None:
            u["drift"] = {"di": 0.0, "threshold": 70.0, "status": "normal", "armed": True, "bad_streak": 0, "clean_streak": 0,
                          "reevaluation_pending": False, "vigilance_threshold": 42.0}
            profile = self._rebuild_profile(u, cause)
            u["drift"]["threshold"] = posttrade.initial_threshold(profile["resume"]["ecart_moyen"], self.cfg)
            u["drift"]["vigilance_threshold"] = round(self.cfg["drift"]["threshold"]["vigilance_factor"] * u["drift"]["threshold"], 1)
            u["drift_base"] = {"at": now_iso(), "state": dict(u["drift"])}
            profile["derive"] = dict(u["drift"])
            self._save_profile(u, profile)
        else:
            if s["mode"] == "cible":
                u["trait_adjustments"] = {}  # la nouvelle mesure contrôlée remplace les ajustements issus des trades
            profile = self._rebuild_profile(u, cause)
            if s["mode"] == "cible" or u["drift"].get("reevaluation_pending"):
                posttrade.after_reevaluation(u["drift"], profile["resume"]["ecart_moyen"], self.cfg)
                u["drift_base"] = {"at": now_iso(), "state": dict(u["drift"])}
            profile["derive"] = dict(u["drift"])
            self._save_profile(u, profile)
            self._webhook(u["user_id"], "profile.updated", self._drift_payload(u, profile))
        self.repo.put("users", u["user_id"], u)

    def _rebuild_profile(self, u: dict, cause: str, extra_evidence: list[str] | None = None) -> dict:
        declared = u["declared"]
        traits = scoring.compute_traits(declared, self._all_decisions(u), self.cfg)
        for code, delta in u["trait_adjustments"].items():
            t = traits[code]
            if t["observed"] is not None:
                t["observed"] = round(min(100.0, max(0.0, t["observed"] + delta)), 1)
                t["low"], t["high"] = round(max(0.0, t["low"] + delta), 1), round(min(100.0, t["high"] + delta), 1)
                t["gap"] = None if t["declared"] is None else round(t["observed"] - t["declared"], 1)
                t["detail"]["ajustement_issu_des_trades"] = round(delta, 1)
        summ = scoring.summary(traits, self.cfg)
        ev = [reveal.trait_evidence(t) for t in traits.values()]
        self._put_evidence(u["user_id"], ev)
        by_id = {e["id"]: e for e in ev}
        base = reveal.profile_sentences(traits, declared, summ)
        sentences, trace = reveal.explain("profil", {"traits": traits, "resume": summ}, base, by_id, self.llm)
        weak = scoring.weaknesses(traits, self.cfg)
        by_trait = {s["trait"]: s for s in sentences if s.get("trait")}
        for w in weak:
            w["probleme"] = by_trait.get(w["trait"], {}).get("texte", "")
            w["statut"] = u["weakness_status"].get(w["trait"], "en_attente")
        prev = self.repo.get("profiles", u["user_id"])
        return {"user_id": u["user_id"], "version": (prev["version"] + 1) if prev else 1, "created_at": now_iso(), "cause": cause,
                "declared": declared, "traits": traits, "resume": summ, "phrases": sentences, "faiblesses": weak,
                "derive": dict(u["drift"] or {}), "trace_explication": trace, "evidence_ids": extra_evidence or []}

    def _save_profile(self, u: dict, profile: dict) -> None:
        self.repo.put("profiles", u["user_id"], profile)
        lite = {"version": profile["version"], "created_at": profile["created_at"], "cause": profile["cause"],
                "derive": profile["derive"], "evidence_ids": profile["evidence_ids"], "resume": profile["resume"],
                "traits": {k: {"observed": t["observed"], "declared": t["declared"]} for k, t in profile["traits"].items()}}
        self.repo.put("profile_versions", f"{u['user_id']}/{profile['version']:05d}", lite)

    def reveal_of(self, session_id: str) -> dict:
        s, _ = self._session(session_id)
        if s["status"] != "finished":
            raise Conflict("La révélation n'est disponible qu'après la dernière décision de la dernière simulation.")
        return self.repo.get("reveals", session_id)

    def profile(self, user_id: str) -> dict:
        self.user(user_id)
        p = self.repo.get("profiles", user_id)
        if not p:
            raise Conflict("Le profil n'existe qu'après une première simulation complète.")
        p["regles"] = self.rules_of(user_id)
        status = self.user(user_id)["weakness_status"]
        for w in p["faiblesses"]:  # l'état du pacte évolue sans créer de nouvelle version du profil
            w["statut"] = status.get(w["trait"], "en_attente")
        return p

    def timeline(self, user_id: str) -> list[dict]:
        return self.repo.list("profile_versions", user_id + "/")

    def evidence(self, user_id: str, evidence_id: str) -> dict:
        e = self.repo.get("evidence", f"{user_id}/{evidence_id}")
        if not e:
            raise NotFound("Preuve inconnue.")
        return e

    def _degraded_traits(self, u: dict) -> list[str]:
        adj = sorted(u["trait_adjustments"].items(), key=lambda kv: -abs(kv[1]))
        traits = [k for k, v in adj if abs(v) > 0][:3]
        if "RT" in traits and "LA" not in traits:
            traits.append("LA")
        return traits or ["HYP", "IMP"]

    # ================================================================== pacte
    def rules_of(self, user_id: str) -> list[dict]:
        return [r for r in self.repo.list("rules", user_id + "/") if r.get("active")]

    def parse_rule(self, user_id: str, text: str, trait: str | None) -> dict:
        p = self.repo.get("profiles", user_id) or {}
        weakness = next((w for w in p.get("faiblesses", []) if w["trait"] == trait), None)
        if not text or len(text.strip()) < 8:
            return {"ok": False, "question": "Écris ta règle avec tes propres mots, en une phrase."}
        return rules.translate(text.strip(), weakness, self.llm)

    def confirm_rule(self, user_id: str, text: str, trait: str | None, strictness: int = 1, replaces: str | None = None) -> dict:
        u = self.user(user_id)
        parsed = self.parse_rule(user_id, text, trait)
        if not parsed["ok"]:
            raise ValueError(parsed["question"])
        p = self.repo.get("profiles", user_id) or {}
        weakness = next((w for w in p.get("faiblesses", []) if w["trait"] == trait), None)
        origin = {"trait": trait, "decision_ids": (weakness or {}).get("decision_ids", []),
                  "situation": self._origin_summary(u, weakness)}
        version = 1
        if replaces:
            old = self.repo.get("rules", f"{user_id}/{replaces}")
            if old:
                old["active"], old["replaced_at"] = False, now_iso()
                self.repo.put("rules", f"{user_id}/{replaces}", old)
                version, origin = old["version"] + 1, old["origin"]
        r = rules.new_rule(user_id, text.strip(), parsed, trait, origin, strictness, version)
        self.repo.put("rules", f"{user_id}/{r['rule_id']}", r)
        self._put_evidence(user_id, [reveal.evidence(r["rule_id"], "règle", "Réel", "Règle écrite par l'utilisateur", {
            "texte": r["text_user"], "lecture_du_systeme": r["lecture"], "niveau_de_rigueur": r["strictness"], "version": r["version"]},
            "Pacte : texte saisi par l'utilisateur, traduit puis confirmé par lui", liens=origin["decision_ids"])])
        if trait:
            u["weakness_status"][trait] = "regle"
            self.repo.put("users", user_id, u)
        return r

    def refuse_rule(self, user_id: str, trait: str) -> dict:
        u = self.user(user_id)
        u["weakness_status"][trait] = "refuse"
        self.repo.put("users", user_id, u)
        self.repo.put("rule_refusals", f"{user_id}/{trait}/{now_iso()}", {"trait": trait, "at": now_iso()})
        return {"trait": trait, "statut": "refuse"}

    def _origin_summary(self, u: dict, weakness: dict | None) -> str | None:
        if not weakness or not weakness["decision_ids"]:
            return None
        target = set(weakness["decision_ids"])
        for sid in reversed(u["sessions"]):
            rv = self.repo.get("reveals", sid)
            for sc in (rv or {}).get("scenarios", []):
                hit = [i for i in sc["evidence_ids"] if i in target]
                if hit:
                    texts = [p["texte"] for p in sc["phrases"] if set(p["evidence_ids"]) & (set(hit) | {f"S-{sc['scenario_id']}"})]
                    return " ".join(texts[:4])
        return None

    # ================================================================== API d'intégration
    def ingest_trade_event(self, ev: dict) -> dict:
        for f in ("event_id", "user_id", "executed_at", "side", "symbol", "amount", "amount_currency"):
            if ev.get(f) in (None, ""):
                raise ValueError(f"Champ obligatoire manquant : {f}")
        if ev["side"] not in ("buy", "sell"):
            raise ValueError("side doit valoir buy ou sell.")
        posttrade.parse_ts(ev["executed_at"])
        self.user(ev["user_id"])
        key = f"{ev['user_id']}/{ev['event_id']}"
        if self.repo.get("trades", key):
            return {"event_id": ev["event_id"], "status": "duplicate"}  # idempotence
        self.repo.put("trade_index", ev["event_id"], {"user_id": ev["user_id"]})
        self.repo.put("trades", key, {**ev, "status": "received", "received_at": now_iso()})
        self.bus.publish("trade.received", {"user_id": ev["user_id"], "event_id": ev["event_id"]})
        return {"event_id": ev["event_id"], "status": "received"}

    def _context(self, user_id: str, symbol: str, at_iso: str, host_ctx: dict | None, extra: dict) -> tuple[dict, dict, bool]:
        """Contexte d'un trade : champs de l'hôte d'abord, jeu de données ensuite, sinon « inconnu »."""
        host_ctx = host_ctx or {}
        ds = self.market.context(symbol, at_iso) or {}
        asset = self.market.asset(symbol)
        ctx, prov = {}, {}
        for f in ("ret_5d_pct", "ret_20d_pct", "vol_20d_pct", "volume_zscore", "drawdown_pct"):
            if host_ctx.get(f) is not None:
                ctx[f], prov[f] = host_ctx[f], "déclaré par l'hôte"
            elif ds.get(f) is not None:
                ctx[f], prov[f] = ds[f], f"jeu de données (séance du {ds['as_of']})"
            else:
                ctx[f], prov[f] = None, "inconnu"
        ctx["hype_flag_host"] = host_ctx.get("hype_flag")
        for f in ("news_flag", "hype_flag"):
            ctx[f] = host_ctx.get(f)
            prov[f] = "déclaré par l'hôte" if host_ctx.get(f) is not None else "inconnu"
        ctx["asset_class"] = extra.get("asset_class") or (asset or {}).get("asset_class")
        ctx["asset_class"] = {"etf_equity": "etf", "etf_bond": "etf", "etf_commodity": "etf"}.get(ctx["asset_class"], ctx["asset_class"])
        ctx["position_weight_after_pct"] = extra.get("position_weight_after_pct")
        ctx["portfolio_value"] = extra.get("portfolio_value")
        ctx["source"] = "jeu de données" if ds else ("déclaré par l'hôte" if host_ctx else "inconnu")
        incomplete = ctx["ret_5d_pct"] is None
        return ctx, prov, incomplete

    def _history(self, user_id: str) -> list[dict]:
        rows = [t for t in self.repo.list("trades", user_id + "/") if t["status"] == "processed"]
        return sorted(rows, key=lambda t: posttrade.parse_ts(t["executed_at"]))

    def _realized_loss(self, trade: dict, history: list[dict]) -> bool | None:
        if trade["side"] != "sell" or trade.get("price") is None:
            return None
        buys = [h for h in history if h["symbol"] == trade["symbol"] and h["side"] == "buy" and h.get("price") is not None]
        if not buys:
            return None
        avg = sum(b["price"] * (b.get("quantity") or 1) for b in buys) / sum((b.get("quantity") or 1) for b in buys)
        return trade["price"] < avg

    def _process_trade(self, msg: dict) -> None:
        uid, eid = msg["user_id"], msg["event_id"]
        u = self.user(uid)
        trade = self.repo.get("trades", f"{uid}/{eid}")
        asset = self.market.asset(trade["symbol"])
        amount_cad = self.market.to_cad(float(trade["amount"]), trade["amount_currency"], trade["executed_at"])
        ctx, prov, incomplete = self._context(uid, trade["symbol"], trade["executed_at"], trade.get("context"), trade)
        t = posttrade.parse_ts(trade["executed_at"])
        history = [h for h in self._history(uid) if posttrade.parse_ts(h["executed_at"]) < t]
        ind = posttrade.objective_indicators(trade, history, ctx, asset, self.cfg)
        ctx["hours_since_loss"] = ind["hours_since_loss"]
        if ctx["hype_flag"] is None:
            ctx["hype_flag"] = ind["hype_marche"]
        matches = rules.match_rules(self.rules_of(uid), ctx, trade["side"], amount_cad)
        violated = [m for m in matches if m["statut"] == "applicable" and m["violation"]]
        profile = self.repo.get("profiles", uid)
        size_flag = None
        if ctx["position_weight_after_pct"] is not None and profile:
            cls = (profile["traits"]["RT"]["detail"] or {}).get("classe") or u["declared"]["risque"]
            size_flag = trade["side"] == "buy" and ctx["position_weight_after_pct"] > self.cfg["allocations"]["position_limit_pct"][cls]
        inv = posttrade.investigate(trade, history, ctx, ind, asset, u["consents"], self.news, self.social, self.cfg, self.llm)
        inv["user_id"] = uid
        s_t, comp = posttrade.severity(inv, bool(violated), size_flag, self.cfg)
        # --- mise à jour bornée des traits (garde-fous de la section 15.1)
        cap = self.cfg["scoring"]["max_points_per_event"] * (0.5 if incomplete else 1.0)
        deltas: dict[str, float] = {}

        def bump(code, x):
            deltas[code] = max(-cap, min(cap, deltas.get(code, 0.0) + x))
        if ind["round_trip"]:
            bump("IMP", cap)
            bump("RT", -cap)
        if inv["verdict"] in ("SOCIAL", "HYPE_MARCHE") and inv["confidence"] >= 0.6:
            bump("HYP", cap * inv["confidence"])
        if inv["verdict"] == "NOUVELLE" and inv["confidence"] >= 0.6 and (violated or size_flag):
            bump("NEWS", cap * inv["confidence"])
        for m in violated:
            if m["rule"].get("trait"):
                bump(m["rule"]["trait"], -cap * 0.67 if m["rule"]["trait"] == "RT" else cap * 0.67)
        if trade["side"] == "sell" and (ctx.get("drawdown_pct") or 0) >= self.cfg["scoring"]["la"]["severe_drawdown_pct"] and not matches:
            bump("LA", cap * 0.67)
            bump("RT", -cap * 0.67)
        if s_t == 0 and inv["verdict"] == "INDETERMINE":
            bump("HYP", -1.0)
            bump("IMP", -1.0)
        for code, x in deltas.items():
            u["trait_adjustments"][code] = round(max(-15.0, min(15.0, u["trait_adjustments"].get(code, 0.0) + x)), 2)
        trade.update({"status": "processed", "processed_at": now_iso(), "amount_cad": round(amount_cad, 2),
                      "contexte": ctx, "provenance": prov, "contexte_incomplet": incomplete, "indicateurs": ind,
                      "severite": s_t, "composantes": comp, "trait_deltas": deltas,
                      "realized_loss": self._realized_loss(trade, history),
                      "regles": [{"rule_id": m["rule"]["rule_id"], "texte": m["rule"]["text_user"], "statut": m["statut"],
                                  "violation": m["violation"], "inconnus": m["inconnus"]} for m in matches],
                      "regle_ignoree": bool(violated), "enquete": {"verdict": inv["verdict"], "verdict_fr": inv["verdict_fr"],
                                                                 "confidence": inv["confidence"]}})
        self.repo.put("trades", f"{uid}/{eid}", trade)
        self.repo.put("investigations", f"{uid}/{eid}", inv)
        was_pending = bool((u["drift"] or {}).get("reevaluation_pending"))
        alert = self._replay_drift(u)
        trade["derive_apres"] = dict(u["drift"]) if u["drift"] else None
        self.repo.put("trades", f"{uid}/{eid}", trade)
        # --- preuves
        sig_ev = [reveal.evidence(s["id"], "signal d'enquête", "Fictif" if "Fictif" in str(s.get("etiquette")) else "Réel", s["libelle"], {
            k: s[k] for k in ("categorie", "type", "source", "time", "heures_avant_le_trade", "relevance", "exposure", "intensity", "decay", "score")},
            s["source"], formule="score = pertinence × exposition × intensité × décroissance (τ = 12 h)") for s in inv["signals"]]
        tid, iid = f"T-{eid[:12]}", f"I-{eid[:12]}"
        self._put_evidence(uid, sig_ev + [
            reveal.evidence(tid, "trade reçu", "Réel", f"Trade reçu : {trade['side']} {trade['symbol']}", {
                "moment": trade["executed_at"], "sens": trade["side"], "actif": trade["symbol"], "montant_cad": round(amount_cad, 2),
                "contexte": ctx, "provenance_du_contexte": prov, "indicateurs": ind, "severite": s_t, "composantes": comp,
                "ajustements_de_traits": deltas, "regle_ignoree": bool(violated)},
                "Événement envoyé par la plateforme hôte (POST /v1/trade-events)", formule="sévérité = min(1, Σ poids × composante)", liens=[iid]),
            reveal.evidence(iid, "enquête", "Hypothèse", f"Enquête automatique : {inv['verdict_fr']}", {
                "verdict": inv["verdict_fr"], "confiance_pct": round(inv["confidence"] * 100), "scores_par_categorie": inv["category_scores"],
                "deuxieme_hypothese": inv["second_hypothesis"], "fenetre_heures": inv["window"]["heures"],
                "couverture_des_sources": inv["sources_coverage"], "donnees_manquantes": inv["data_gaps"]},
                "Agent enquêteur (backend/mirror/posttrade.py)", formule=inv["avertissement"], liens=[s["id"] for s in inv["signals"]])])
        if u["drift"] is not None and profile:
            p = self._rebuild_profile(u, f"Trade reçu : {trade['side']} {trade['symbol']}", [tid, iid])
            self._save_profile(u, p)
            self._webhook(uid, "profile.updated", self._drift_payload(u, p))
        self.repo.put("users", uid, u)
        self._webhook(uid, "investigation.completed", {"event_id": eid, "user_id": uid, "verdict": inv["verdict"],
                                                       "confidence": inv["confidence"], "severity": s_t})
        if alert and not was_pending:
            self._webhook(uid, "reevaluation.required", {"user_id": uid, "event_id": eid, "reasons": alert,
                                                         "reevaluation_url": f"/?user={uid}#/reevaluation"})

    def _replay_drift(self, u: dict) -> list[str] | None:
        """Rejoue les sévérités dans l'ordre de `executed_at` (tolère les événements en retard)."""
        if u["drift"] is None:
            return None
        base = u.get("drift_base")
        if base is None:
            base = {"at": "1970-01-01T00:00:00Z", "state": {**u["drift"], "di": 0.0, "bad_streak": 0, "clean_streak": 0, "armed": True,
                                                         "reevaluation_pending": False, "status": "normal",
                                                         "threshold": u.get("threshold0", u["drift"]["threshold"])}}
            u["threshold0"] = base["state"]["threshold"]
            u["drift_base"] = base
        state = dict(base["state"])
        reasons = None
        for h in self._history(u["user_id"]):
            if h.get("processed_at", "") < base["at"]:
                continue
            res = posttrade.update_drift(state, h["severite"], self.cfg)
            if res["alert"]:
                reasons = res["reasons"]
        u["drift"] = state
        return reasons if state.get("reevaluation_pending") else None

    def _drift_payload(self, u: dict, profile: dict) -> dict:
        d = u["drift"]
        return {"user_id": u["user_id"], "profile_version": profile["version"], "drift_index": d["di"],
                "reevaluation_threshold": d["threshold"], "status": d["status"]}

    def trade_result(self, event_id: str) -> dict:
        idx = self.repo.get("trade_index", event_id)
        if not idx:
            raise NotFound("Événement inconnu.")
        t = self.repo.get("trades", f"{idx['user_id']}/{event_id}")
        if t["status"] != "processed":
            return {"event_id": event_id, "status": t["status"]}
        d = t.get("derive_apres") or {}
        return {"event_id": event_id, "status": "processed", "user_id": t["user_id"], "severity": t["severite"],
                "components": t["composantes"], "indicators": t["indicateurs"], "context_incomplete": t["contexte_incomplet"],
                "rule_ignored": t["regle_ignoree"], "rules": t["regles"], "investigation": t["enquete"],
                "drift_index": d.get("di"), "reevaluation_threshold": d.get("threshold"), "drift_status": d.get("status"),
                "profile_version": (self.repo.get("profiles", t["user_id"]) or {}).get("version"),
                "reevaluation_url": f"/?user={t['user_id']}#/reevaluation" if d.get("reevaluation_pending") else None}

    def investigation(self, event_id: str) -> dict:
        idx = self.repo.get("trade_index", event_id)
        inv = self.repo.get("investigations", f"{idx['user_id']}/{event_id}") if idx else None
        if not inv:
            raise NotFound("Enquête inconnue ou encore en cours.")
        return inv

    def trades(self, user_id: str) -> list[dict]:
        return sorted(self.repo.list("trades", user_id + "/"), key=lambda t: t["executed_at"], reverse=True)

    def check_intent(self, intent: dict) -> dict:
        for f in ("user_id", "side", "symbol", "amount"):
            if intent.get(f) in (None, ""):
                raise ValueError(f"Champ obligatoire manquant : {f}")
        uid = intent["user_id"]
        u = self.user(uid)
        at = intent.get("at") or now_iso()
        amount_cad = self.market.to_cad(float(intent["amount"]), intent.get("amount_currency", "CAD"), at)
        ctx, prov, _ = self._context(uid, intent["symbol"], at, intent.get("context"), intent)
        asset = self.market.asset(intent["symbol"])
        t = posttrade.parse_ts(at)
        history = [h for h in self._history(uid) if posttrade.parse_ts(h["executed_at"]) < t]
        ind = posttrade.objective_indicators({**intent, "executed_at": at, "event_id": "intent"}, history, ctx, asset, self.cfg)
        ctx["hours_since_loss"] = ind["hours_since_loss"]
        if ctx["hype_flag"] is None:
            ctx["hype_flag"] = ind["hype_marche"]
        matches = rules.match_rules(self.rules_of(uid), ctx, intent["side"], amount_cad)
        gid = "GD-" + uuid.uuid4().hex[:8]
        drift = u["drift"] or {}
        items = [{"rule_id": m["rule"]["rule_id"], "ta_regle": m["rule"]["text_user"], "lecture": m["rule"]["lecture"],
                  "niveau_de_rigueur": m["rule"]["strictness"], "statut": m["statut"], "similarite": m["similarite"],
                  "depasse_ta_regle": m["violation"], "donnees_inconnues": m["inconnus"],
                  "situation_d_origine": m["rule"]["origin"].get("situation"), "version_compatible": m["version_compatible"]}
                 for m in matches]
        out = {"guard_decision_id": gid, "result": "reminder" if items else "no_match", "reminder": items,
               "contexte": ctx, "provenance": prov,
               "vigilance": ("Aucune de tes règles ne s'applique, mais ton indice de dérive est élevé : prends un moment avant de décider."
                             if not items and drift.get("status") in ("vigilance", "alerte") else None),
               "note": "Rappel de tes propres règles. Ce n'est pas un conseil financier et rien n'est bloqué.",
               "reminder_url": f"/?user={uid}#/rappel/{gid}"}
        self.repo.put("guard_decisions", f"{uid}/{gid}", {**out, "intent": intent, "at": at})
        return out

    def guard_decision(self, user_id: str, gid: str) -> dict:
        g = self.repo.get("guard_decisions", f"{user_id}/{gid}")
        if not g:
            raise NotFound("Rappel inconnu.")
        return g

    # ================================================================== webhooks
    def register_webhook(self, url: str | None, secret: str | None = None) -> dict:
        cfg = {"url": url, "secret": secret or uuid.uuid4().hex, "registered_at": now_iso()}
        self.repo.put("webhooks", "host", cfg)
        return cfg

    def _webhook(self, user_id: str, event: str, payload: dict) -> None:
        hook = self.repo.get("webhooks", "host") or {"url": None, "secret": os.environ.get("MIRROR_WEBHOOK_SECRET", "dev-secret")}
        body = json.dumps({"event": event, "sent_at": now_iso(), "data": payload}, ensure_ascii=False).encode()
        sig = "sha256=" + hmac.new(hook["secret"].encode(), body, hashlib.sha256).hexdigest()
        did = f"{now_iso()}-{uuid.uuid4().hex[:6]}"
        rec = {"id": did, "event": event, "user_id": user_id, "body": json.loads(body), "signature": sig,
               "url": hook["url"], "status": "journalisé (aucune URL enregistrée)" if not hook["url"] else "en cours"}
        self.repo.put("webhook_deliveries", did, rec)
        if hook["url"] and self.sender:
            def go():
                try:
                    code = self.sender.send(hook["url"], body, {"Content-Type": "application/json", "X-Mirror-Event": event,
                                                                "X-Mirror-Signature": sig})
                    rec["status"] = f"livré ({code})"
                except Exception as e:  # la livraison ne doit jamais bloquer l'analyse
                    rec["status"] = f"échec : {type(e).__name__}"
                self.repo.put("webhook_deliveries", did, rec)
            threading.Thread(target=go, daemon=True).start()

    def webhook_deliveries(self, user_id: str | None = None) -> list[dict]:
        rows = self.repo.list("webhook_deliveries")
        return [r for r in rows if not user_id or r["user_id"] == user_id][-30:][::-1]


def build_local_service(data_root: str | Path | None = None, persist: str | Path | None = None, sync_bus: bool = True) -> MirrorService:
    from .adapters_local import (FileNewsSource, HttpWebhookSender, InProcessBus, JsonRepository,
                                 SyntheticSocialSource, TemplateTextModel)
    from .market import CsvMarketData
    root = Path(data_root or ROOT / "data")
    return MirrorService(load_config(), JsonRepository(persist), CsvMarketData(root / "starter"),
                         EpisodeLibrary(root / "episode_library.json"), TemplateTextModel(), InProcessBus(sync=sync_bus),
                         FileNewsSource(root / "demo" / "news_demo.json"), SyntheticSocialSource(root / "demo" / "social_synthetic.json"),
                         HttpWebhookSender())
