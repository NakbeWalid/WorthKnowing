"""Révélation (contrefactuels calculés sur les vraies données), journal de preuves et explications.

Principe d'explicabilité : toute phrase affichée cite des identifiants de preuve, et un
validateur rejette toute phrase dont un nombre n'apparaît pas dans les preuves citées.
"""
from __future__ import annotations

import re

from .scoring import FORMULA_VERSION, TRAITS

MOIS = "janvier février mars avril mai juin juillet août septembre octobre novembre décembre".split()
RISQUE_FR = {"faible": "faible", "faible_modere": "faible à modéré", "modere": "modéré", "eleve": "élevé", "tres_eleve": "très élevé"}
ACTION_FR = {"hold": "tenu", "sell": "vendu", "add": "renforcé"}
NBSP = " "


def pct(x: float, signed: bool = True) -> str:
    s = f"{abs(x):.1f}".rstrip("0").rstrip(".").replace(".", ",")
    sign = ("+" if x > 0 else "−" if x < 0 else "") if signed else ""
    return f"{sign}{s}{NBSP}%"


def money(x: float) -> str:
    return f"{round(x):,}".replace(",", NBSP).replace("-", "−") + f"{NBSP}$"


def month_year(iso: str) -> str:
    return f"{MOIS[int(iso[5:7]) - 1]} {iso[:4]}"


# --------------------------------------------------------------------------- contrefactuels

def trajectories(sc: dict, ep: dict, v0: float, declared_threshold: float) -> dict:
    """Trois trajectoires de la mise, à chaque arrêt mensuel, à partir des données réelles."""
    idx = [c["index"] for c in ep["checkpoints"]]
    hold = [round(v0 * i / 100) for i in idx]
    user, units, cashd, sold_value = [], 1.0, 0.0, None
    adds = {a["step"]: a["amount"] for a in sc["adds"]}
    for k, i in enumerate(idx):
        if k in adds and sold_value is None:
            units += adds[k] / (v0 * i / 100)
            cashd -= adds[k]
        if sc["sold_step"] == k and sold_value is None:
            sold_value = v0 * units * i / 100 + cashd
        user.append(round(sold_value if sold_value is not None else v0 * units * i / 100 + cashd))
    policy, out_value, policy_step = [], None, None
    for k, c in enumerate(ep["checkpoints"]):
        if out_value is None and k > 0 and c["drawdown_from_peak_pct"] <= -declared_threshold:
            out_value, policy_step = v0 * c["index"] / 100, k
        policy.append(round(out_value if out_value is not None else v0 * c["index"] / 100))
    return {"tenir": hold, "toi": user, "profil_declare": policy, "profil_declare_vente_mois": policy_step,
            "mise_de_depart": round(v0)}


# --------------------------------------------------------------------------- preuves

def _numbers(obj) -> list[float]:
    out = []
    if isinstance(obj, bool) or obj is None:
        return out
    if isinstance(obj, (int, float)):
        out.append(float(obj))
    elif isinstance(obj, str):  # nombres contenus dans un nom propre ou une date (« Nasdaq-100 »)
        out += [float(x.replace(",", ".")) for x in re.findall(r"\d+(?:[.,]\d+)?", obj)]
    elif isinstance(obj, dict):
        for v in obj.values():
            out += _numbers(v)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            out += _numbers(v)
    return out


def evidence(eid: str, kind: str, tag: str, titre: str, donnees: dict, source: str, formule: str | None = None, liens=None) -> dict:
    return {"id": eid, "type": kind, "etiquette": tag, "titre": titre, "donnees": donnees, "source": source,
            "formule": formule, "liens": liens or [], "nombres": _numbers(donnees)}


def decision_evidence(d: dict, label: str) -> dict:
    return evidence(d["decision_id"], "décision", "Réel", f"Décision au mois {d['step']} — {label}", {
        "mois": d["step"], "action": ACTION_FR[d["action"]], "temps_de_reponse_s": round(d["decision_time_ms"] / 1000, 1),
        "rendement_depuis_le_debut_pct": d["ret_since_start"], "baisse_sous_le_sommet_pct": d["drawdown_from_peak"],
        "gain_ou_perte_de_la_position": d["position_pnl"], "poids_de_la_position_apres_pct": d["position_weight"],
        "limite_declaree_pct": d["limit_pct"], "condition": "avec stimulus" if d["trigger_ids"] else "contrôle (aucun stimulus)",
        "declencheurs": d["trigger_ids"], "intensite": d["trigger_intensity"], "stimulus_suivi": d["aligned"],
        "actif_reconnu": d["recognition_flag"], "horodatage": d["t_decision"],
    }, "Décision enregistrée pendant la simulation ; valeurs de marché tirées de data/episode_library.json")


def trait_evidence(t: dict) -> dict:
    return evidence(f"M-{t['code']}", "mesure", "Hypothèse", t["nom"], {
        "declare_sur_100": t["declared"], "observe_sur_100": t["observed"], "intervalle_bas": t["low"],
        "intervalle_haut": t["high"], "confiance_pct": round(t["confidence"] * 100), "decisions_pertinentes": t["n"],
        "echelle": 100, "niveau_intervalle_pct": 80, "seuil_decision_rapide_s": 3, **t["detail"],
    }, "Calculé par le moteur d'analyse (backend/mirror/scoring.py) à partir des décisions liées",
        formule=f"{t['formule']} — {t['aide']}", liens=t["decision_ids"])


# --------------------------------------------------------------------------- révélation

def build_reveal(session: dict, declared: dict, library, market, cfg: dict, v0: float) -> tuple[list[dict], list[dict]]:
    thr = cfg["scoring"]["declared_drawdown_threshold_pct"][declared["risque"]]
    scenarios, ev = [], []
    for sc in session["scenarios"]:
        if not sc.get("ended"):
            continue
        ep = library.get(sc["episode_id"])
        traj = trajectories(sc, ep, v0, thr)
        decs = [d for d in session["decisions"] if d["scenario_id"] == sc["scenario_id"]]
        sid, cid = f"S-{sc['scenario_id']}", f"C-{sc['scenario_id']}"
        st = ep["stats"]
        ev.append(evidence(sid, "scénario", "Réel", f"{sc['label']} : {ep['name_truth']}", {
            "actif": ep["name_truth"], "symbole": ep["ticker_truth"], "debut": ep["start"], "fin": ep["end"],
            "annee_debut": int(ep["start"][:4]), "annee_fin": int(ep["end"][:4]),
            "rendement_sur_la_fenetre_pct": st["total_return_pct"], "pire_baisse_pct": st["max_drawdown_pct"],
            "rendement_12_mois_apres_pct": st["after_window_12m_return_pct"], "horizon_apres_mois": 12,
            "pire_journee_pct": st["worst_day_pct"], "devise": ep["currency"],
            "choix_du_directeur": sc["trace"]["raison"],
        }, "prices_daily.csv (adj_close, Yahoo Finance via yfinance) ; épisode " + ep["episode_id"]))
        ev.append(evidence(cid, "contrefactuel", "Réel", f"Trois trajectoires — {sc['label']}", {
            "mise_de_depart": traj["mise_de_depart"], "ta_valeur_finale": traj["toi"][-1],
            "valeur_finale_en_tenant": traj["tenir"][-1], "valeur_finale_profil_declare": traj["profil_declare"][-1],
            "seuil_de_vente_du_profil_declare_pct": thr, "mois_de_vente_du_profil_declare": traj["profil_declare_vente_mois"],
            "ecart_avec_tenir": traj["toi"][-1] - traj["tenir"][-1],
        }, "Recalculé à partir des indices mensuels de l'épisode", formule="Politique du profil déclaré : vendre dès que la baisse sous le sommet atteint le seuil déclaré (hypothèse)"))
        for d in decs:
            ev.append(decision_evidence(d, sc["label"]))
        short = sc["label"].split(",")[0]
        s = [{"texte": f"{short}, c'était {ep['name_truth']} ({ep['ticker_truth']}). Le scénario débutait en {month_year(ep['start'])}.",
              "evidence_ids": [sid], "etiquette": "Réel"}]
        for d in decs:
            s.append({"texte": f"Au mois {d['step']}, la position était à {pct(d['ret_since_start'])} depuis le début et à "
                               f"{pct(abs(d['drawdown_from_peak']), False)} sous son sommet ; tu as {ACTION_FR[d['action']]} "
                               f"en {str(round(d['decision_time_ms'] / 1000, 1)).replace('.', ',')} s.",
                      "evidence_ids": [d["decision_id"]], "etiquette": "Réel"})
        tail = f"À la fin de la fenêtre, l'actif était à {pct(st['total_return_pct'])} depuis le départ"
        if st["after_window_12m_return_pct"] is not None:
            tail += f", puis a fait {pct(st['after_window_12m_return_pct'])} dans les 12 mois suivants"
        s.append({"texte": tail + ".", "evidence_ids": [sid], "etiquette": "Réel"})
        s.append({"texte": f"Pour une mise de {money(traj['mise_de_depart'])} : tu termines à {money(traj['toi'][-1])}, "
                           f"tenir jusqu'au bout donnait {money(traj['tenir'][-1])}, et suivre ton profil déclaré donnait "
                           f"{money(traj['profil_declare'][-1])}.", "evidence_ids": [cid], "etiquette": "Réel"})
        shown = [t for step in sc["shown"].values() for t in step]
        fict = [t for t in shown if t["fictif"]]
        if fict:
            s.append({"texte": "Les messages et notifications affichés pendant ce scénario étaient simulés : "
                               "leurs auteurs n'existent pas.", "evidence_ids": [sid], "etiquette": "Fictif"})
        path = market.path(ep["ticker_truth"], ep["start"], ep["end"])
        scenarios.append({
            "scenario_id": sc["scenario_id"], "label": sc["label"], "name": ep["name_truth"], "ticker": ep["ticker_truth"],
            "periode": f"{month_year(ep['start'])} à {month_year(ep['end'])}", "type": ep["type"],
            "chart": path, "decision_points": [{"mois": d["step"], "action": d["action"], "x": d["step"] * 21} for d in decs],
            "trajectoires": traj, "declencheurs": [{"mois": int(k), **{f: t[f] for f in ("id", "nom", "forme", "auteur", "texte", "fictif")}}
                                                 for k, v in sc["shown"].items() for t in v],
            "stats": st, "phrases": s, "evidence_ids": [sid, cid] + [d["decision_id"] for d in decs],
            "directeur": sc["trace"], "validation": sc.get("validation_log", {}), "reconnu": sc.get("recognition"),
        })
    return scenarios, ev


# --------------------------------------------------------------------------- explications du profil

DETAIL_FR = {
    "LA": "Tu as vendu dans {ventes_en_forte_baisse} des {decisions_en_forte_baisse} décisions prises en forte baisse.",
    "IMP": "{decisions_en_moins_de_3_s} de tes {decisions} décisions ont été prises en moins de 3 secondes.",
    "HYP": "Tu as suivi {stimulus_suivis} des {decisions_avec_stimulus} messages sociaux affichés ; sans message, le même geste arrive dans {taux_de_base_pct} % des cas.",
    "NEWS": "Tu as suivi {stimulus_suivis} des {decisions_avec_stimulus} nouvelles ou rumeurs affichées ; sans nouvelle, le même geste arrive dans {taux_de_base_pct} % des cas.",
    "VAL": "Tu as renforcé {renforcements_contraires} fois sur {occasions_contraires_aux_valeurs} un actif d'un secteur que tu as déclaré vouloir éviter.",
    "DIV": "Tu as dépassé ta limite de position {depassements} fois sur {occasions_de_depassement} occasions.",
    "DISP": "Tu as vendu dans {ventes_en_gain} des {decisions_en_gain} décisions en gain, contre {ventes_en_perte} des {decisions_en_perte} décisions en perte.",
}


def _n(x) -> str:
    return (f"{x:.1f}".rstrip("0").rstrip(".") if isinstance(x, float) else str(x)).replace(".", ",")


def profile_sentences(traits: dict, declared: dict, summ: dict) -> list[dict]:
    out = []
    for code, t in traits.items():
        eid = f"M-{code}"
        if t["observed"] is None:
            out.append({"trait": code, "texte": f"{t['nom']} : données insuffisantes pour conclure.", "evidence_ids": [eid], "etiquette": "Hypothèse"})
            continue
        if code == "RT":
            d = t["detail"]
            txt = (f"Tu as déclaré un risque {RISQUE_FR[declared['risque']]}, soit une vente attendue vers {_n(d['seuil_declare_pct'])}{NBSP}% de baisse. "
                   f"Tes décisions situent ton seuil de vente vers {_n(d['seuil_vente_pct'])}{NBSP}% de baisse "
                   f"(entre {_n(d['seuil_bas_pct'])} et {_n(d['seuil_haut_pct'])}{NBSP}%), ce qui correspond à un profil "
                   f"{RISQUE_FR[d['classe']]}. Confiance : {round(t['confidence'] * 100)}{NBSP}%.")
        else:
            dec = "non déclaré" if t["declared"] is None else f"déclaré {_n(t['declared'])} sur 100"
            txt = (f"{t['nom']} : {dec}, observé {_n(t['observed'])} sur 100 (entre {_n(t['low'])} et {_n(t['high'])}). "
                   f"Confiance : {round(t['confidence'] * 100)}{NBSP}%. " + DETAIL_FR[code].format(**{k: _n(v) for k, v in t["detail"].items()}))
        out.append({"trait": code, "texte": txt, "evidence_ids": [eid], "etiquette": "Hypothèse"})
    return out


# --------------------------------------------------------------------------- validateur d'explications

_NUM = re.compile(r"\d[\d\s]*(?:,\d+)?")


def validate_sentences(sentences: list[dict], evidence_by_id: dict[str, dict]) -> list[dict]:
    """Renvoie les phrases rejetées (preuve inexistante ou nombre absent des preuves citées)."""
    rejected = []
    for s in sentences:
        missing = [e for e in s["evidence_ids"] if e not in evidence_by_id]
        allowed = [abs(n) for e in s["evidence_ids"] if e in evidence_by_id for n in evidence_by_id[e]["nombres"]]
        bad = []
        for raw in _NUM.findall(s["texte"]):
            num = float(re.sub(r"\s", "", raw).replace(",", "."))
            if not any(abs(num - a) < 0.051 or abs(num - round(a)) < 1e-9 for a in allowed):
                bad.append(raw.strip())
        if missing or bad or not s["evidence_ids"]:
            rejected.append({"texte": s["texte"], "preuves_manquantes": missing, "nombres_sans_preuve": bad})
    return rejected


def explain(kind: str, dossier: dict, fallback: list[dict], evidence_by_id: dict, model=None) -> tuple[list[dict], dict]:
    """Agent d'explicabilité : le modèle peut rédiger, mais seul un texte validé est affiché."""
    trace = {"composant": "Agent d'explicabilité", "type": kind, "source": "gabarits", "rejets": 0}
    if model is not None:
        cand = model.explain(kind, dossier)
        if cand:
            rej = validate_sentences(cand, evidence_by_id)
            trace["rejets"] = len(rej)
            if not rej:
                trace["source"] = f"modèle {model.name}"
                return cand, trace
    rej = validate_sentences(fallback, evidence_by_id)
    assert not rej, f"Gabarit d'explication invalide : {rej}"
    return fallback, trace
