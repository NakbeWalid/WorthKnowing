"""Après un trade reçu : enquête automatique (Agent enquêteur), sévérité, indice de dérive et seuil.

Tout est déterministe. Le modèle de langage ne peut qu'aider à juger la PERTINENCE d'une
nouvelle ou d'une publication ; il n'attribue jamais la cause. Aucune donnée postérieure
au trade n'est utilisée. La cause est une hypothèse, pas une preuve de causalité.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

CATEGORIES_FR = {"SOCIAL": "influence sociale", "HYPE_MARCHE": "hype de marché", "NOUVELLE": "nouvelle",
                 "IMPULSION": "impulsion", "AUCUN_SIGNAL": "aucun signal"}


def parse_ts(iso: str) -> datetime:
    dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)


def iso_utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# --------------------------------------------------------------------------- indicateurs objectifs

def objective_indicators(trade: dict, history: list[dict], ctx: dict, asset: dict | None, cfg: dict) -> dict:
    """Indicateurs de la section 15.2. Une valeur None signifie « inconnu »."""
    d = cfg["drift"]
    t = parse_ts(trade["executed_at"])
    same = [h for h in history if h["symbol"] == trade["symbol"] and parse_ts(h["executed_at"]) < t]
    crypto = (trade.get("asset_class") or (asset or {}).get("asset_class")) == "crypto"
    thr = d["hype"]["ret_5d_crypto_pct" if crypto else "ret_5d_equity_pct"]
    r5, vz = ctx.get("ret_5d_pct"), ctx.get("volume_zscore")
    hype = None
    if ctx.get("hype_flag") is True or (r5 is not None and r5 >= thr) or (vz is not None and vz >= d["hype"]["volume_z"]):
        hype = True
    elif r5 is not None or ctx.get("hype_flag") is False:
        hype = False
    opposite = "sell" if trade["side"] == "buy" else "buy"
    rt = any(h["side"] == opposite and t - parse_ts(h["executed_at"]) <= timedelta(hours=d["round_trip_hours"]) for h in same)
    recent = [h for h in same if t - parse_ts(h["executed_at"]) <= timedelta(days=d["overtrading"]["days"])]
    lost = [h for h in history if h.get("realized_loss") and parse_ts(h["executed_at"]) < t and
            t - parse_ts(h["executed_at"]) <= timedelta(hours=d["loss_chasing_hours"])]
    last_loss_h = min([(t - parse_ts(h["executed_at"])).total_seconds() / 3600 for h in history
                       if h.get("realized_loss") and parse_ts(h["executed_at"]) < t], default=None)
    return {"hype_marche": hype, "seuil_hausse_5j_pct": thr, "round_trip": rt,
            "overtrading": len(recent) + 1 >= d["overtrading"]["count"],
            "loss_chasing": trade["side"] == "buy" and bool(lost), "hours_since_loss": last_loss_h,
            "trades_recents_meme_actif": len(recent)}


# --------------------------------------------------------------------------- enquête

def investigate(trade: dict, history: list[dict], ctx: dict, ind: dict, asset: dict | None, consents: dict,
                news, social, cfg: dict, model=None) -> dict:
    c = cfg["investigation"]
    t = parse_ts(trade["executed_at"])
    start = t - timedelta(hours=c["window_hours"])
    s_iso, t_iso = iso_utc(start), iso_utc(t)
    ticker = (asset or {}).get("ticker") or trade["symbol"].upper()
    sector = (asset or {}).get("sector")
    signals, gaps = [], []

    def add(cat, typ, source, time_iso, r, e, m, label, extra=None):
        age_h = max(0.0, (t - parse_ts(time_iso)).total_seconds() / 3600)
        dec = math.exp(-age_h / c["tau_hours"])
        signals.append({"id": f"G-{trade['event_id'][:8]}-{len(signals) + 1}", "categorie": cat, "type": typ, "source": source,
                        "time": time_iso, "heures_avant_le_trade": round(age_h, 1), "relevance": round(r, 2),
                        "exposure": round(e, 2), "intensity": round(m, 2), "decay": round(dec, 2),
                        "score": round(r * e * m * dec, 3), "libelle": label, **(extra or {})})

    def relevance(item):
        syms = [s.upper() for s in item.get("symbols", [])]
        if ticker in syms or trade["symbol"].upper() in syms:
            return c["relevance"]["symbol"]
        if sector and item.get("sector") == sector:
            return c["relevance"]["sector"]
        if item.get("theme") == "macro":
            return c["relevance"]["macro"]
        if model is not None:  # aide du modèle, plafonnée : la correspondance exacte du symbole prime
            r = model.classify_relevance(item, ticker, asset)
            if r:
                return min(float(r), c["relevance"]["sector"])
        return 0.0

    # 1) Nouvelles publiques (métadonnées seulement), publiées AVANT le trade.
    for it in news.items(s_iso, t_iso):
        r = relevance(it)
        if r > 0 and parse_ts(it["published_at"]) < t:
            add("NOUVELLE", "nouvelle publique", it["source"], it["published_at"], r, c["exposure"]["public_news"],
                it.get("importance", 0.5), it["title"], {"url": it.get("url"), "etiquette": it.get("etiquette", "Externe, non vérifiée")})

    # 2) Comptes liés : uniquement ceux pour lesquels le consentement est actif.
    coverage = {}
    for platform in social.platforms:
        if not consents.get(platform, {}).get("granted"):
            coverage[platform] = "non lié (aucun consentement)"
            continue
        cov = social.coverage(platform)
        coverage[platform] = cov
        for p in social.items(trade["user_id"], platform, s_iso, t_iso):
            r = relevance(p)
            if r <= 0 or parse_ts(p["published_at"]) >= t:
                continue
            if p.get("user_interaction"):
                e = c["exposure"]["interaction"]
            else:
                e = c["exposure"]["followed"] * (c["partial_coverage_factor"] if cov == "partielle" else 1.0)
            add("SOCIAL", "proche" if p.get("account_type") == "proche" else "influenceur", f"{platform} — {p['account']}",
                p["published_at"], r, e, p.get("engagement", 0.5), p["text"],
                {"interaction": p.get("user_interaction"), "etiquette": "Fictif (jeu synthétique de démonstration)"})
    if not any(v.get("granted") for v in consents.values()):
        gaps.append("aucun compte lié : l'influence sociale ne peut pas être observée")

    # 3) Signaux de marché (jeu de données ou contexte fourni par l'hôte).
    r5, vz = ctx.get("ret_5d_pct"), ctx.get("volume_zscore")
    thr = ind["seuil_hausse_5j_pct"]
    if r5 is not None and r5 >= thr:
        add("HYPE_MARCHE", "hausse rapide", ctx.get("source", "contexte"), t_iso, 1.0, c["exposure"]["market"],
            min(1.0, r5 / (2 * thr) + 0.5), f"Hausse de {r5} % sur 5 jours")
    if vz is not None and vz >= cfg["drift"]["hype"]["volume_z"]:
        add("HYPE_MARCHE", "pic de volume", ctx.get("source", "contexte"), t_iso, 1.0, c["exposure"]["market"],
            min(1.0, vz / 4 + 0.5), f"Volume inhabituel (z = {vz})")
    if ctx.get("hype_flag_host") is True:
        add("HYPE_MARCHE", "popularité signalée par l'hôte", "donnée déclarée par l'hôte", t_iso, 1.0, c["exposure"]["market"], 0.9,
            "L'hôte signale un actif très discuté")
    if r5 is None and vz is None:
        gaps.append("donnée de contexte de marché non disponible")

    # 4) Historique des trades : schémas d'impulsion.
    for key, label in (("round_trip", "Aller-retour sur le même actif en moins de 24 h"),
                       ("overtrading", "Rafale de trades sur le même actif"),
                       ("loss_chasing", "Achat dans les 24 h suivant une perte")):
        if ind.get(key):
            add("IMPULSION", key, "historique des trades reçus", t_iso, 1.0, c["exposure"]["history"],
                c["impulse_scores"][key], label)

    scores = {}
    for cat in ("NOUVELLE", "SOCIAL", "HYPE_MARCHE", "IMPULSION"):
        prod = 1.0
        for s in signals:
            if s["categorie"] == cat:
                prod *= 1 - s["score"]
        scores[cat] = round(1 - prod, 3)
    ranked = sorted(scores.items(), key=lambda kv: -kv[1])
    top, second = ranked[0], ranked[1]
    if top[1] >= c["verdict_min"]:
        verdict, conf = top[0], round(top[1] * (1 - second[1]), 3)
    else:
        verdict, conf = "INDETERMINE", 0.0
    if not signals:
        scores["AUCUN_SIGNAL"] = 1.0
    return {"trade_id": trade["event_id"], "window": {"debut": s_iso, "fin": t_iso, "heures": c["window_hours"]},
            "signals": sorted(signals, key=lambda s: -s["score"]), "category_scores": scores, "verdict": verdict,
            "verdict_fr": CATEGORIES_FR.get(verdict, "indéterminé"), "confidence": conf,
            "second_hypothesis": {"categorie": second[0], "score": second[1]},
            "sources_coverage": {"nouvelles": "métadonnées publiques datées", "marche": ctx.get("source", "inconnu"), **coverage},
            "data_gaps": gaps,
            "avertissement": "Hypothèse fondée sur la proximité dans le temps et l'exposition. Ce n'est pas une preuve de causalité."}


# --------------------------------------------------------------------------- sévérité et dérive

def severity(inv: dict, rule_override: bool, size_vs_tolerance: bool | None, cfg: dict) -> tuple[float, dict]:
    w = cfg["drift"]["weights"]
    cs, v = inv["category_scores"], inv["verdict"]
    comp = {
        # Seule la cause probable (verdict) compte, pondérée par la force de sa catégorie.
        # (La confiance, qui mesure l'écart avec la 2e hypothèse, sert à borner les mises à jour de traits.)
        "SOCIAL": w["SOCIAL"] * (cs["SOCIAL"] if v == "SOCIAL" else 0.0),
        "HYPE_MARCHE": w["HYPE_MARCHE"] * (cs["HYPE_MARCHE"] if v == "HYPE_MARCHE" else 0.0),
        "NOUVELLE": w["NOUVELLE"] * (cs["NOUVELLE"] if v == "NOUVELLE" else 0.0),
        "IMPULSION": w["IMPULSION"] * cs.get("IMPULSION", 0.0),
        "rule_override": w["rule_override"] if rule_override else 0.0,
        "size_vs_tolerance": w["size_vs_tolerance"] if size_vs_tolerance else 0.0,
    }
    comp = {k: round(x, 3) for k, x in comp.items()}
    return round(min(1.0, sum(comp.values())), 3), comp


def initial_threshold(mean_gap: float, cfg: dict) -> float:
    t = cfg["drift"]["threshold"]
    return round(float(min(t["max"], max(t["min"], t["base"] - t["gap_factor"] * mean_gap))), 1)


def update_drift(state: dict, s_t: float, cfg: dict) -> dict:
    """Met à jour l'indice de dérive, le seuil personnel et le statut. `state` est modifié et renvoyé."""
    d, th = cfg["drift"], cfg["drift"]["threshold"]
    state["di"] = round(min(100.0, max(0.0, d["decay"] * state["di"] + d["growth"] * 100 * s_t)), 1)
    bad = s_t >= d["bad_trade_severity"]
    state["bad_streak"] = state.get("bad_streak", 0) + 1 if bad else 0
    state["clean_streak"] = state.get("clean_streak", 0) + 1 if s_t == 0 else 0
    if bad:
        state["threshold"] -= th["drop_on_bad_trade"]
    elif state["clean_streak"] >= th["clean_streak"]:
        state["threshold"] += th["raise_after_clean_streak"]
        state["clean_streak"] = 0
    state["threshold"] = round(float(min(th["max"], max(th["min"], state["threshold"]))), 1)
    if not state.get("armed", True) and state["di"] < state["threshold"] - th["rearm_gap"]:
        state["armed"] = True
    reasons = []
    if state["di"] >= state["threshold"]:
        reasons.append("indice de dérive au-dessus du seuil personnel")
    if state["bad_streak"] >= d["consecutive_bad_alert"]:
        reasons.append(f"{d['consecutive_bad_alert']} trades problématiques d'affilée")
    if s_t >= d["single_trade_alert"]:
        reasons.append("un trade très sévère")
    alert = bool(reasons) and state.get("armed", True)
    if alert:
        state["armed"] = False
    if alert or state.get("reevaluation_pending"):
        state["status"] = "alerte"
        state["reevaluation_pending"] = True
    elif state["di"] >= th["vigilance_factor"] * state["threshold"]:
        state["status"] = "vigilance"
    else:
        state["status"] = "normal"
    state["vigilance_threshold"] = round(th["vigilance_factor"] * state["threshold"], 1)
    return {"alert": alert, "reasons": reasons}


def after_reevaluation(state: dict, mean_gap: float, cfg: dict) -> None:
    th = cfg["drift"]["threshold"]
    target = th["base"] - th["gap_factor"] * mean_gap
    state["threshold"] = round(float(min(th["max"], max(th["min"], 0.5 * state["threshold"] + 0.5 * target))), 1)
    state["di"] = round(state["di"] * cfg["drift"]["resume_factor"], 1)
    state["reevaluation_pending"] = False
    state["bad_streak"] = 0
    state["status"] = "vigilance" if state["di"] >= th["vigilance_factor"] * state["threshold"] else "normal"
    state["vigilance_threshold"] = round(th["vigilance_factor"] * state["threshold"], 1)
