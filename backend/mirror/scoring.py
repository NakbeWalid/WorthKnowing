"""Moteur d'analyse comportementale : code déterministe, aucune intervention d'un modèle de langage.

Chaque trait est un score de 0 à 100 avec un intervalle à 80 % et une confiance.
Les formules sont versionnées (FORMULA_VERSION) et citées dans le journal de preuves.
"""
from __future__ import annotations

import numpy as np
from scipy.stats import beta as beta_dist

from .scenarios import NEWS_IDS, SOCIAL_IDS

FORMULA_VERSION = "v1"
TRAITS = {
    "RT": ("Tolérance au risque", "Baisse que tu supportes avant de vendre. Plus haut = tu tolères plus."),
    "LA": ("Panique en baisse", "Part de tes ventes faites en forte baisse. Plus haut = tu vends plus souvent dans la baisse."),
    "IMP": ("Impulsivité", "Part de tes décisions prises très vite. Plus haut = plus impulsif."),
    "HYP": ("Sensibilité au hype", "Effet des messages d'influenceurs, de proches et de la popularité sur tes décisions."),
    "NEWS": ("Réactivité aux nouvelles", "Effet des nouvelles et des rumeurs sur tes décisions."),
    "VAL": ("Écarts à tes valeurs", "Part de tes décisions contraires aux exclusions que tu as déclarées."),
    "DIV": ("Dépassement de tes limites", "Part des occasions où tu as dépassé ta limite de position déclarée."),
    "DISP": ("Gains encaissés trop tôt", "Tendance à vendre ce qui monte et à garder ce qui baisse."),
}
SELF_ITEMS = {  # énoncé d'auto-évaluation -> (trait, sens)
    "calme_baisses": ("LA", -1), "resiste_modes": ("HYP", -1), "decide_vite": ("IMP", 1),
    "nouvelles_stables": ("NEWS", -1), "respecte_limites": ("DIV", -1),
}


def declared_scores(declared: dict, cfg: dict) -> dict:
    sc = cfg["scoring"]
    thr = sc["declared_drawdown_threshold_pct"][declared["risque"]]
    out = {"RT": round(min(100, thr / sc["rt"]["scale_max_pct"] * 100), 1), "VAL": 10.0 if declared.get("exclusions") else None,
           "DISP": None}
    for item, (trait, sign) in SELF_ITEMS.items():
        x = declared.get("auto_evaluation", {}).get(item, 3)
        out[trait] = round(((x - 1) if sign > 0 else (5 - x)) / 4 * 80 + 10, 1)
    return out


def _w(d: dict, cfg: dict) -> float:
    return cfg["scoring"]["recognition_weight"] if d.get("recognition_flag") == "oui" else 1.0


def _rate(k: float, n: float, level: float):
    a, b = 1 + k, 1 + n - k
    lo, hi = beta_dist.ppf([(1 - level) / 2, 1 - (1 - level) / 2], a, b)
    return a / (a + b), float(lo), float(hi)


def _confidence(n: float, width: float, cfg: dict) -> float:
    return round(float(np.clip(min(1.0, n / cfg["scoring"]["confidence"]["n_full"]) * (1 - width / 100), 0, 1)), 2)


def _result(code, declared, observed, lo, hi, n, ids, detail, cfg):
    if observed is None:
        return {"code": code, "nom": TRAITS[code][0], "aide": TRAITS[code][1], "declared": declared, "observed": None,
                "low": None, "high": None, "n": round(n, 1), "confidence": 0.0, "statut": "données insuffisantes",
                "decision_ids": ids, "detail": detail, "formule": f"{code} {FORMULA_VERSION}", "gap": None}
    observed, lo, hi = (round(float(np.clip(v, 0, 100)), 1) for v in (observed, lo, hi))
    return {"code": code, "nom": TRAITS[code][0], "aide": TRAITS[code][1], "declared": declared, "observed": observed,
            "low": lo, "high": hi, "n": round(n, 1), "confidence": _confidence(n, hi - lo, cfg), "statut": "mesuré",
            "decision_ids": ids, "detail": detail, "formule": f"{code} {FORMULA_VERSION}",
            "gap": None if declared is None else round(observed - declared, 1)}


def _risk_tolerance(decisions, declared, cfg):
    p = cfg["scoring"]["rt"]
    thr0 = cfg["scoring"]["declared_drawdown_threshold_pct"][declared["risque"]]
    rel = [d for d in decisions if d["drawdown_from_peak"] <= -p["min_drawdown_pct"]]
    grid = np.arange(2.0, 80.5, 0.5)
    logp = -0.5 * ((grid - thr0) / p["prior_sd"]) ** 2
    n = 0.0
    for d in rel:
        w = _w(d, cfg) * (p["stimulus_weight"] if d["trigger_ids"] else 1.0)
        n += w
        ps = 1 / (1 + np.exp(-p["slope"] * (-d["drawdown_from_peak"] - grid)))
        ps = np.clip(ps, 1e-6, 1 - 1e-6)
        logp += w * np.log(ps if d["action"] == "sell" else 1 - ps)
    post = np.exp(logp - logp.max())
    post /= post.sum()
    cdf = np.cumsum(post)
    lvl = cfg["scoring"]["interval"]
    theta = float((grid * post).sum())
    lo, hi = float(grid[np.searchsorted(cdf, (1 - lvl) / 2)]), float(grid[min(len(grid) - 1, np.searchsorted(cdf, 1 - (1 - lvl) / 2))])
    cls = next(name for limit, name in p["classes"] if theta < limit)
    detail = {"seuil_vente_pct": round(theta, 1), "seuil_bas_pct": lo, "seuil_haut_pct": hi, "classe": cls,
              "seuil_declare_pct": thr0, "decisions_en_baisse": len(rel),
              "ventes_en_baisse": sum(1 for d in rel if d["action"] == "sell")}
    if n < 1:
        return None, None, None, n, [d["decision_id"] for d in rel], detail
    s = 100 / p["scale_max_pct"]
    return theta * s, lo * s, hi * s, n, [d["decision_id"] for d in rel], detail


def _stimulus_effect(decisions, ids, cfg):
    """P(action alignée | stimulus) − P(même action | contrôle)."""
    stim = [d for d in decisions if set(d["trigger_ids"]) & ids and d["aligned"] is not None]
    ctrl = [d for d in decisions if not d["trigger_ids"]]
    n = sum(_w(d, cfg) for d in stim)
    k = sum(_w(d, cfg) for d in stim if d["aligned"])
    nc = max(1, len(ctrl))
    base_buy = sum(1 for d in ctrl if d["action"] == "add") / nc
    base_sell = sum(1 for d in ctrl if d["action"] == "sell") / nc
    base = float(np.mean([base_buy if "buy" in d["valences"] else base_sell for d in stim])) if stim else 0.0
    detail = {"decisions_avec_stimulus": len(stim), "stimulus_suivis": sum(1 for d in stim if d["aligned"]),
              "decisions_de_controle": len(ctrl), "taux_de_base_pct": round(base * 100, 1)}
    if n < 2:
        return None, None, None, n, [d["decision_id"] for d in stim], detail
    m, lo, hi = _rate(k, n, cfg["scoring"]["interval"])
    return (m - base) * 100, (lo - base) * 100, (hi - base) * 100, n, [d["decision_id"] for d in stim], detail


def _simple_rate(rel, bad, cfg, labels):
    n = sum(_w(d, cfg) for d in rel)
    k = sum(_w(d, cfg) for d in rel if bad(d))
    detail = {labels[0]: len(rel), labels[1]: sum(1 for d in rel if bad(d))}
    ids = [d["decision_id"] for d in rel]
    if n < 2:
        return None, None, None, n, ids, detail
    m, lo, hi = _rate(k, n, cfg["scoring"]["interval"])
    return m * 100, lo * 100, hi * 100, n, ids, detail


def compute_traits(declared: dict, decisions: list[dict], cfg: dict) -> dict:
    sc = cfg["scoring"]
    dec = declared_scores(declared, cfg)
    out = {}
    out["RT"] = _result("RT", dec["RT"], *_risk_tolerance(decisions, declared, cfg), cfg)
    sev = [d for d in decisions if d["drawdown_from_peak"] <= -sc["la"]["severe_drawdown_pct"]]
    out["LA"] = _result("LA", dec["LA"], *_simple_rate(sev, lambda d: d["action"] == "sell", cfg,
                                                       ("decisions_en_forte_baisse", "ventes_en_forte_baisse")), cfg)
    out["IMP"] = _result("IMP", dec["IMP"], *_simple_rate(decisions, lambda d: d["decision_time_ms"] < sc["imp"]["fast_ms"], cfg,
                                                          ("decisions", "decisions_en_moins_de_3_s")), cfg)
    out["HYP"] = _result("HYP", dec["HYP"], *_stimulus_effect(decisions, SOCIAL_IDS, cfg), cfg)
    out["NEWS"] = _result("NEWS", dec["NEWS"], *_stimulus_effect(decisions, NEWS_IDS, cfg), cfg)
    val = [d for d in decisions if "T09" in d["trigger_ids"]]
    out["VAL"] = _result("VAL", dec["VAL"], *_simple_rate(val, lambda d: d["action"] == "add", cfg,
                                                          ("occasions_contraires_aux_valeurs", "renforcements_contraires")), cfg)
    div = [d for d in decisions if "T10" in d["trigger_ids"]]
    out["DIV"] = _result("DIV", dec["DIV"], *_simple_rate(
        div, lambda d: d["action"] == "add" and d["position_weight"] > d["limit_pct"], cfg,
        ("occasions_de_depassement", "depassements")), cfg)
    gains = [d for d in decisions if d["ret_since_start"] >= sc["disp"]["gain_pct"]]
    losses = [d for d in decisions if d["ret_since_start"] <= sc["disp"]["loss_pct"]]
    ids = [d["decision_id"] for d in gains + losses]
    detail = {"decisions_en_gain": len(gains), "ventes_en_gain": sum(1 for d in gains if d["action"] == "sell"),
              "decisions_en_perte": len(losses), "ventes_en_perte": sum(1 for d in losses if d["action"] == "sell")}
    if len(gains) >= 2 and len(losses) >= 2:
        g, glo, ghi = _rate(detail["ventes_en_gain"], len(gains), sc["interval"])
        l, _, _ = _rate(detail["ventes_en_perte"], len(losses), sc["interval"])
        out["DISP"] = _result("DISP", None, (g - l) * 100, (glo - l) * 100, (ghi - l) * 100, min(len(gains), len(losses)), ids, detail, cfg)
    else:
        out["DISP"] = _result("DISP", None, None, None, None, min(len(gains), len(losses)), ids, detail, cfg)
    return out


def weaknesses(traits: dict, cfg: dict) -> list[dict]:
    g = cfg["scoring"]["gap"]
    out = []
    for code, t in traits.items():
        if t["observed"] is None:
            continue
        if code == "RT":
            bad = t["gap"] is not None and t["gap"] <= -g["rt_points"] and t["high"] < t["declared"]
        elif t["declared"] is None:
            bad = t["observed"] >= g["undeclared_points"]
        else:
            bad = t["gap"] >= g["other_points"] and t["low"] > t["declared"] - 5
        if bad:
            out.append({"trait": code, "nom": t["nom"], "decision_ids": t["decision_ids"], "evidence_id": f"M-{code}"})
    return out


def summary(traits: dict, cfg: dict) -> dict:
    measured = [t for t in traits.values() if t["observed"] is not None]
    conf = float(np.mean([t["confidence"] for t in measured])) if measured else 0.0
    gaps = [abs(t["gap"]) for t in measured if t["gap"] is not None]
    return {"confiance_moyenne": round(conf, 2), "preliminaire": conf < cfg["scoring"]["confidence"]["preliminary_below"],
            "ecart_moyen": round(float(np.mean(gaps)), 1) if gaps else 0.0, "traits_mesures": len(measured)}
