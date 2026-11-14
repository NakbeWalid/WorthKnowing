"""Tests de bout en bout du cœur (aucun service AWS requis)."""
import json
import re

import pytest

from mirror import posttrade, reveal, rules, scoring
from mirror.scenarios import validate_trigger
from mirror.service import Conflict, build_local_service


@pytest.fixture()
def svc():
    return build_local_service()


def play(svc, uid, policy, mode="demo", seed="graine-test", targets=None):
    """Joue une session entière avec une politique `policy(view) -> (action, temps_ms)`."""
    v = svc.start_session(uid, mode, targets=targets, seed=seed)
    sid, views = v["session_id"], []
    while v["status"] != "finished":
        if v["status"] == "awaiting_recognition":
            v = svc.recognition(sid, "non")
            continue
        views.append(v)
        action, ms = policy(v)
        v = svc.decide(sid, action, ms)
    return sid, views


def panic(v):  # vend dès −15 % sous le sommet ou si un message pousse à vendre ; suit les messages d'achat
    if v["drawdown_pct"] <= -15:
        return "sell", 1500
    if any(t["famille"] == "social" for t in v["triggers"]):
        return "add", 1800
    return "hold", 6000


def calm(v):
    return "hold", 9000


def test_masked_view_never_leaks_identity(svc):
    u = svc.create_user("amira")
    _, views = play(svc, u["user_id"], calm, mode="complet")
    lib = svc.library
    names = {e["name_truth"].lower() for e in lib.episodes} | {e["ticker_truth"].lower() for e in lib.episodes}
    blob = json.dumps(views, ensure_ascii=False).lower()
    for n in names:
        assert not re.search(rf"(?<![a-z]){re.escape(n)}(?![a-z])", blob), n
    assert not re.search(r"20(19|2\d)-\d\d-\d\d", blob), "aucune date ne doit apparaître"
    assert "episode_id" not in blob and "ticker" not in blob
    assert len(views) >= 16  # 8 scénarios, 2 à 3 arrêts


def test_no_reveal_before_the_end(svc):
    u = svc.create_user("amira")
    v = svc.start_session(u["user_id"], "demo", seed="x")
    with pytest.raises(Conflict):
        svc.reveal_of(v["session_id"])
    with pytest.raises(Conflict):
        svc.profile(u["user_id"])


def test_no_episode_repeated_and_sessions_differ(svc):
    u = svc.create_user("robert")
    s1, _ = play(svc, u["user_id"], calm, seed="a")
    s2, _ = play(svc, u["user_id"], calm, seed="b")
    e1 = {s["episode_id"] for s in svc.repo.get("sessions", s1)["scenarios"]}
    e2 = {s["episode_id"] for s in svc.repo.get("sessions", s2)["scenarios"]}
    assert not e1 & e2


def test_declared_vs_observed_gap_and_explanations_are_evidenced(svc):
    u = svc.create_user("amira")
    uid = u["user_id"]
    sid, _ = play(svc, uid, panic, mode="complet")
    p = svc.profile(uid)
    rt = p["traits"]["RT"]
    assert rt["observed"] is not None and rt["observed"] < rt["declared"], "une vendeuse en panique tolère moins que déclaré"
    assert "RT" in {w["trait"] for w in p["faiblesses"]}
    # Chaque phrase affichée ne cite que des nombres présents dans ses preuves.
    ev = {e["id"]: e for e in svc.repo.list("evidence", uid + "/")}
    rv = svc.reveal_of(sid)
    sentences = p["phrases"] + [ph for sc in rv["scenarios"] for ph in sc["phrases"]]
    assert sentences and reveal.validate_sentences(sentences, ev) == []
    # Un nombre inventé est rejeté.
    fake = [{"texte": "Tu as perdu 987 654 $.", "evidence_ids": ["M-RT"]}]
    assert reveal.validate_sentences(fake, ev)


def test_counterfactuals_match_independent_computation(svc):
    u = svc.create_user("amira")
    sid, _ = play(svc, u["user_id"], calm)
    for sc in svc.reveal_of(sid)["scenarios"]:
        ep = next(e for e in svc.library.episodes if e["ticker_truth"] == sc["ticker"] and e["type"] == sc["type"]
                  and reveal.month_year(e["start"]) in sc["periode"])
        expected = round(svc.engine.v0 * ep["checkpoints"][-1]["index"] / 100)
        assert sc["trajectoires"]["tenir"][-1] == expected
        assert sc["trajectoires"]["toi"][-1] == expected  # elle a tout tenu


def test_trigger_validator_rejects_leaks_and_invented_numbers(svc):
    ep = svc.library.get("EP-TSLA-crash_no_recovery-2022-02-24")
    facts = {"ret": -17.7, "dd": -42.5, "pnl": -2655.0, "limit": 20}
    ok = {"id": "T05", "intensity": 2, "texte": "Alerte : ta position a perdu 2 655 $ depuis le début (42,5 % sous son sommet)."}
    assert validate_trigger(ok, facts, ep) == []
    assert validate_trigger({**ok, "texte": "Tesla a perdu 42,5 %."}, facts, ep)
    assert validate_trigger({**ok, "texte": "Ce titre a perdu 60 %."}, facts, ep)
    assert validate_trigger({**ok, "texte": "En mai 2022, ce titre a perdu 42,5 %."}, facts, ep)


def test_rule_translation_never_invents_content():
    r = rules.parse_rule_text("Si un titre a monté de plus de 40 % en 5 jours, j'attends 24 h avant d'acheter")
    assert r["ok"] and r["action"] == {"type": "cooldown", "params": {"hours": 24, "side": "buy"}}
    assert r["trigger"]["all"][0] == {"feature": "ret_5d_pct", "op": ">", "value": 40.0}
    r = rules.parse_rule_text("Jamais plus de 5 % dans un même titre")
    assert r["ok"] and r["action"]["params"]["pct"] == 5.0
    vague = rules.parse_rule_text("Je veux être plus prudent à l'avenir")
    assert not vague["ok"] and "?" in vague["question"]
    assert not re.search(r"\d", vague["question"]), "la question de clarification ne suggère aucune valeur"


def trade(uid, eid, when, side="buy", symbol="NVDA", amount=9000, **extra):
    return {"event_id": eid, "user_id": uid, "executed_at": when, "side": side, "symbol": symbol,
            "amount": amount, "amount_currency": "CAD", **extra}


def ready_user(svc, persona="robert"):
    u = svc.create_user(persona)
    play(svc, u["user_id"], panic)
    return u["user_id"]


def test_trade_event_pipeline_guard_investigation_and_drift(svc):
    uid = ready_user(svc)
    svc.set_source(uid, "instagram", True)
    rule = svc.confirm_rule(uid, "Jamais plus de 5 % dans un même titre", "DIV")
    chk = svc.check_intent({"user_id": uid, "side": "buy", "symbol": "NVDA", "amount": 9000, "amount_currency": "CAD",
                            "portfolio_value": 60000, "position_weight_after_pct": 15, "at": "2026-11-10T19:30:00Z"})
    assert chk["result"] == "reminder" and chk["reminder"][0]["rule_id"] == rule["rule_id"]
    assert chk["reminder"][0]["version_compatible"]["montant"] == 3000  # 5 % de 60 000 $
    before = svc.profile(uid)["derive"]["di"]
    ack = svc.ingest_trade_event(trade(uid, "evt-0001", "2026-11-10T19:30:00Z", portfolio_value=60000, position_weight_after_pct=15))
    assert ack["status"] == "received"
    assert svc.ingest_trade_event(trade(uid, "evt-0001", "2026-11-10T19:30:00Z"))["status"] == "duplicate"
    res = svc.trade_result("evt-0001")
    assert res["status"] == "processed" and res["rule_ignored"] is True
    inv = svc.investigation("evt-0001")
    assert inv["verdict"] in ("SOCIAL", "HYPE_MARCHE") and inv["confidence"] > 0
    assert all(posttrade.parse_ts(s["time"]) <= posttrade.parse_ts("2026-11-10T19:30:00Z") for s in inv["signals"])
    assert res["drift_index"] > before
    events = [d["event"] for d in svc.webhook_deliveries(uid)]
    assert "investigation.completed" in events and "profile.updated" in events
    assert all(d["signature"].startswith("sha256=") for d in svc.webhook_deliveries(uid))


def test_no_consent_means_no_social_signal(svc):
    uid = ready_user(svc)
    svc.ingest_trade_event(trade(uid, "evt-0002", "2026-11-10T19:30:00Z"))
    inv = svc.investigation("evt-0002")
    assert not [s for s in inv["signals"] if s["categorie"] == "SOCIAL"]
    assert "instagram" in inv["sources_coverage"] and "non lié" in inv["sources_coverage"]["instagram"]


def test_unknown_asset_gives_undetermined_and_no_penalty(svc):
    uid = ready_user(svc)
    before = svc.profile(uid)
    svc.ingest_trade_event(trade(uid, "evt-0003", "2026-11-10T19:30:00Z", symbol="ZZZZ", amount=500))
    res = svc.trade_result("evt-0003")
    assert res["context_incomplete"] is True and res["investigation"]["verdict"] == "INDETERMINE"
    assert res["severity"] == 0 and res["drift_index"] == before["derive"]["di"]


def test_repeated_bad_trades_trigger_reevaluation_then_targeted_session_resets(svc):
    uid = ready_user(svc)
    svc.set_source(uid, "instagram", True)
    svc.confirm_rule(uid, "Jamais plus de 5 % dans un même titre", "DIV")
    t0 = svc.profile(uid)["derive"]["threshold"]
    for i, hour in enumerate(("17:00", "18:00", "19:00", "19:30")):
        side = "buy" if i % 2 == 0 else "sell"
        svc.ingest_trade_event(trade(uid, f"evt-1{i}", f"2026-11-10T{hour}:00Z", side=side, portfolio_value=60000,
                                     position_weight_after_pct=15))
    d = svc.profile(uid)["derive"]
    assert d["status"] == "alerte" and d["reevaluation_pending"] and d["threshold"] < t0
    assert "reevaluation.required" in [x["event"] for x in svc.webhook_deliveries(uid)]
    play(svc, uid, calm, mode="cible", seed="reeval")
    d2 = svc.profile(uid)["derive"]
    assert d2["reevaluation_pending"] is False and d2["di"] < d["di"]


def test_late_event_is_replayed_in_execution_order(svc):
    uid = ready_user(svc)
    svc.ingest_trade_event(trade(uid, "evt-b", "2026-11-10T19:00:00Z", side="sell"))
    svc.ingest_trade_event(trade(uid, "evt-a", "2026-11-10T18:30:00Z", side="buy"))  # arrive en retard
    order = [t["event_id"] for t in svc._history(uid)]
    assert order == ["evt-a", "evt-b"]


def test_parameter_recovery_orders_synthetic_personas(svc):
    """Personas synthétiques à vérité connue : le seuil de vente observé suit le vrai seuil."""
    thetas = {}
    for true_thr in (12, 30, 55):
        u = svc.create_user("amira")
        play(svc, u["user_id"], lambda v, th=true_thr: ("sell", 5000) if v["drawdown_pct"] <= -th else ("hold", 5000),
             mode="complet", seed=f"rec-{true_thr}")
        thetas[true_thr] = svc.profile(u["user_id"])["traits"]["RT"]["detail"]["seuil_vente_pct"]
    assert thetas[12] < thetas[30] < thetas[55]


def test_pact_status_follows_user_actions(svc):
    u = svc.create_user("amira")
    uid = u["user_id"]
    play(svc, uid, panic, mode="complet")
    weak = svc.profile(uid)["faiblesses"]
    assert weak and all(w["statut"] == "en_attente" for w in weak)
    svc.confirm_rule(uid, "Si une position baisse de plus de 20 %, j'attends 48 h avant de vendre", weak[0]["trait"])
    assert svc.profile(uid)["faiblesses"][0]["statut"] == "regle"
    if len(weak) > 1:
        svc.refuse_rule(uid, weak[1]["trait"])
        assert svc.profile(uid)["faiblesses"][1]["statut"] == "refuse"
