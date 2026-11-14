"""Bibliothèque d'épisodes réels, masquage, catalogue de déclencheurs, Directeur et Validateur.

- Les chiffres de marché viennent TOUJOURS de la bibliothèque (données réelles).
- Le Directeur choisit quel épisode et quels déclencheurs présenter (brief, sections 4 et 7).
- Le Validateur refuse tout stimulus qui laisse fuiter l'identité ou cite un chiffre absent des faits.
"""
from __future__ import annotations

import json
import random
import re
from pathlib import Path

# --------------------------------------------------------------------------- bibliothèque

SECTOR_LABELS = {
    "Information Technology": "technologie à forte croissance",
    "Communication Services": "services de communication et numérique",
    "Consumer Discretionary": "consommation discrétionnaire",
    "Consumer Staples": "biens de consommation de base",
    "Financials": "services financiers",
    "Health Care": "soins de santé",
    "Industrials": "industrie et transport",
    "Utilities": "services publics",
    "Energy": "énergie (pétrole et gaz)",
    "Crypto asset": "cryptoactif",
    "Gold": "fonds adossé à l'or",
}
CLASS_LABELS = {
    "etf_bond": "fonds d'obligations",
    "etf_equity": "fonds d'actions diversifié",
    "etf_commodity": "fonds de matières premières",
}


class EpisodeLibrary:
    def __init__(self, path: str | Path):
        self.episodes = json.loads(Path(path).read_text(encoding="utf-8"))
        self.by_id = {e["episode_id"]: e for e in self.episodes}

    def get(self, episode_id: str) -> dict:
        return self.by_id[episode_id]

    def find(self, types: list[str], *, sector: str | None = None, allow_crypto: bool = True,
             exclude_ids: set[str] = frozenset(), exclude_tickers: set[str] = frozenset()) -> list[dict]:
        out = []
        for e in self.episodes:
            if e["type"] not in types or e["episode_id"] in exclude_ids or e["ticker_truth"] in exclude_tickers:
                continue
            if sector and e["sector"] != sector:
                continue
            if not sector and e["sector"] == "Energy" and False:
                continue
            if not allow_crypto and e["asset_class"] == "crypto":
                continue
            out.append(e)
        return out


def masked_label(episode: dict, letter: str) -> str:
    sector = episode["sector"]
    if episode["asset_class"] == "etf_bond":
        kind = "fonds d'obligations à long terme" if "long" in sector.lower() else (
            "fonds d'obligations à très court terme" if "ultra" in sector.lower() else "fonds d'obligations diversifié")
    elif episode["asset_class"] == "etf_equity":
        kind = "fonds d'actions à critères ESG" if "ESG" in sector else (
            "fonds d'actions de croissance" if "growth" in sector.lower() else "fonds d'actions de marché large")
    else:
        kind = SECTOR_LABELS.get(sector) or CLASS_LABELS.get(episode["asset_class"], "actif")
    return f"Actif {letter}, {kind}"


def decision_steps(episode: dict, n: int) -> list[int]:
    """Choisit les arrêts décisionnels là où il se passe quelque chose (baisse ou hausse marquée)."""
    cps = episode["checkpoints"]
    last = len(cps) - 2  # jamais le tout dernier arrêt : il reste une suite à révéler
    down = episode["type"] in ("crash_no_recovery", "drop_then_recovery", "single_day_shock")
    key = (lambda c: c["drawdown_from_peak_pct"]) if down else (lambda c: -c["ret_since_start_pct"])
    inner = cps[1:last + 1]
    first = next((c["step"] for c in inner if c["drawdown_from_peak_pct"] <= -10 or c["ret_since_start_pct"] >= 15), 2)
    extreme = min(inner, key=key)["step"]
    if extreme <= first:
        extreme = min(last, first + 3)
    steps = {first, extreme}
    if n >= 3:
        mid = (first + extreme) // 2
        steps.add(mid if mid not in steps else min(last, extreme + 1))
    out = sorted(steps)
    while len(out) < n:
        cand = [s for s in range(1, last + 1) if s not in out]
        if not cand:
            break
        out = sorted(out + [cand[len(cand) // 2]])
    return out[:n]


# --------------------------------------------------------------------------- déclencheurs

TRIGGERS = {
    "T01": dict(nom="Publication d'une personnalité influente", famille="social", trait="HYP", forme="publication"),
    "T02": dict(nom="Message d'un proche", famille="social", trait="HYP", forme="message"),
    "T03": dict(nom="Preuve sociale", famille="social", trait="HYP", forme="notification"),
    "T04": dict(nom="Nouvelle construite sur un fait des données", famille="nouvelle", trait="NEWS", forme="nouvelle"),
    "T05": dict(nom="Notification de perte", famille="perte", trait="LA", forme="notification"),
    "T06": dict(nom="Pression de temps", famille="temps", trait="IMP", forme="minuteur"),
    "T07": dict(nom="Rumeur non vérifiée", famille="nouvelle", trait="NEWS", forme="nouvelle"),
    "T08": dict(nom="Ancrage sur le sommet", famille="ancrage", trait="DISP", forme="notification"),
    "T09": dict(nom="Conflit de valeurs", famille="valeurs", trait="VAL", forme="message"),
    "T10": dict(nom="Occasion de concentration", famille="concentration", trait="DIV", forme="notification"),
    "T11": dict(nom="Gain rapide", famille="gain", trait="DISP", forme="notification"),
    "T12": dict(nom="Popularité", famille="social", trait="HYP", forme="notification"),
    "T13": dict(nom="Autorité", famille="social", trait="HYP", forme="publication"),
    "T14": dict(nom="Contre-signal", famille="social", trait="HYP", forme="publication"),
}
SOCIAL_IDS = {k for k, v in TRIGGERS.items() if v["famille"] == "social"}
NEWS_IDS = {"T04", "T07"}

# Gabarits d'intensité : les seuls nombres fictifs autorisés dans un stimulus.
INTENSITY = {
    "T03": {1: 61, 2: 74, 3: 88},
    "T06": {1: 20, 2: 12, 3: 8},
}
INFLUENCEURS = ["@MarieAnalyse", "@LeoFinances", "@NadiaInvestit", "@SamCroissance"]
PROCHES = ["Karim, ton cousin", "Sophie, une collègue", "Julien, un ami", "Inès, ta sœur"]

_T = {
    ("T01", "buy"): ["{who} : « Ce titre a déjà pris {ret} % et je continue d'en acheter. »",
                     "{who} : « +{ret} % et ce n'est que le début. J'en rachète aujourd'hui. »",
                     "{who} : « +{ret} % ! Ceux qui n'en ont pas vont le regretter. J'ajoute massivement. »"],
    ("T01", "sell"): ["{who} : « Ce titre recule de {dd} % depuis son sommet. J'allège ma position. »",
                      "{who} : « −{dd} % depuis le sommet. Je sors, ça sent mauvais. »",
                      "{who} : « −{dd} % et ça va continuer. Je vends tout, sortez tant qu'il est temps ! »"],
    ("T02", "buy"): ["{who} : « J'en ai acheté un peu cette semaine, ça monte bien. »",
                     "{who} : « J'en ai racheté hier, ça a pris {ret} %. Tu devrais regarder. »",
                     "{who} : « J'ai mis un gros montant dessus, +{ret} % déjà. Fais comme moi, vite ! »"],
    ("T02", "sell"): ["{who} : « J'ai vendu une partie des miens, je préfère être prudent. »",
                      "{who} : « J'ai tout vendu hier, −{dd} % c'était trop pour moi. »",
                      "{who} : « J'ai tout vendu, −{dd} % ! Ne reste pas là-dedans, vends maintenant. »"],
    ("T03", "buy"): ["{p} % des investisseurs de la plateforme renforcent cet actif aujourd'hui."] * 3,
    ("T03", "sell"): ["{p} % des investisseurs de la plateforme vendent cet actif aujourd'hui."] * 3,
    ("T05", "sell"): ["Ta position a perdu {loss} $ depuis le début.",
                      "Alerte : ta position a perdu {loss} $ depuis le début ({dd} % sous son sommet).",
                      "Alerte rouge : −{loss} $ sur ta position. Elle est {dd} % sous son sommet."],
    ("T07", "sell"): ["Selon des sources anonymes, cet actif ferait face à des difficultés. Information non confirmée.",
                      "Rumeur : selon des sources anonymes, de mauvaises nouvelles seraient imminentes pour cet actif. Non confirmé.",
                      "Rumeur virale : des sources anonymes annoncent un effondrement imminent de cet actif. Aucune confirmation officielle."],
    ("T07", "buy"): ["Selon des sources anonymes, une bonne nouvelle se préparerait pour cet actif. Information non confirmée.",
                     "Rumeur : selon des sources anonymes, une annonce très favorable serait imminente. Non confirmé.",
                     "Rumeur virale : des sources anonymes promettent une envolée imminente de cet actif. Aucune confirmation officielle."],
    ("T08", "hold"): ["Rappel : ta position est {dd} % sous son plus haut."] * 3,
    ("T09", "buy"): ["{who} : « Ce titre du secteur de l'énergie a pris {ret} %. Tes principes te coûtent cher, non ? »",
                     "{who} : « +{ret} % pour ce titre pétrolier pendant que tes fonds responsables stagnent. Renforce-le. »",
                     "{who} : « +{ret} % ! Oublie tes critères ESG cette fois, tout le monde en profite sauf toi. »"],
    ("T10", "buy"): ["Cet actif progresse de {ret} %. Renforcer porterait sa part au-delà de ta limite déclarée de {limit} %.",
                     "+{ret} % : renforce pendant que ça monte ? Sa part dépasserait ta limite déclarée de {limit} %.",
                     "+{ret} % et ça continue ! Renforce maintenant. (Sa part dépasserait ta limite déclarée de {limit} %.)"],
    ("T11", "sell"): ["Ta position affiche +{ret} % depuis le début. Encaisser le gain ?",
                      "+{ret} % déjà ! Sécuriser ce gain maintenant ?",
                      "+{ret} % ! Un gain pareil ne dure jamais. Encaisse avant qu'il disparaisse."],
    ("T12", "buy"): ["Cet actif fait partie des plus discutés cette semaine.",
                     "Tendance : cet actif est le plus discuté de la semaine (+{ret} % depuis le début).",
                     "Tout le monde en parle : actif numéro un des discussions, +{ret} % depuis le début !"],
    ("T13", "buy"): ["Un analyste (fictif) relève son opinion sur cet actif.",
                     "Un analyste réputé (fictif) relève fortement son opinion sur cet actif après +{ret} %.",
                     "Un analyste vedette (fictif) : « conviction maximale » sur cet actif après +{ret} %."],
    ("T13", "sell"): ["Un analyste (fictif) abaisse son opinion sur cet actif.",
                      "Un analyste réputé (fictif) abaisse fortement son opinion sur cet actif après −{dd} %.",
                      "Un analyste vedette (fictif) : « à fuir » après −{dd} % sous le sommet."],
    ("T14", "buy"): ["{who} : « Ce titre ne baisse jamais vraiment. C'est le moment d'en reprendre. »",
                     "{who} : « Aucun risque sur ce titre, il remonte toujours. J'en rachète. »",
                     "{who} : « Impossible de perdre avec ce titre. Achetez les yeux fermés ! »"],
}


def _fr(x: float) -> str:
    s = f"{abs(x):.1f}".rstrip("0").rstrip(".")
    return s.replace(".", ",")


def _money(x: float) -> str:
    return f"{abs(round(x)):,}".replace(",", " ")


def trigger_valence(tid: str, facts: dict) -> str | None:
    if tid in ("T05", "T11"):
        return "sell"
    if tid in ("T09", "T10", "T12", "T14"):
        return "buy"
    if tid == "T08":
        return "hold"
    if tid == "T06":
        return None
    if tid == "T04":
        return facts.get("news_valence")
    if tid == "T07":
        return "sell" if facts["ret"] >= 0 else "buy"
    return "buy" if facts["ret"] > 0 and facts["dd"] > -10 else "sell"


def trigger_applicable(tid: str, facts: dict) -> bool:
    if tid == "T05":
        return facts["pnl"] <= -500
    if tid in ("T11", "T12", "T10", "T09"):
        return facts["ret"] >= 8
    if tid == "T08":
        return facts["dd"] <= -8
    if tid == "T14":
        return facts["dd"] <= -10
    if tid == "T04":
        return facts.get("news_text") is not None
    return True


def render_trigger(spec: dict, facts: dict, rng: random.Random, model=None) -> dict | None:
    """Produit le stimulus affiché. `model` (Bedrock) peut proposer un texte ; il est revalidé."""
    tid, level = spec["id"], spec["intensity"]
    meta = TRIGGERS[tid]
    val = trigger_valence(tid, facts)
    out = {"id": tid, "nom": meta["nom"], "famille": meta["famille"], "forme": meta["forme"],
           "intensity": level, "valence": val, "auteur": None, "texte": "", "timer_seconds": None, "fictif": True}
    if tid == "T06":
        out["timer_seconds"] = INTENSITY["T06"][level]
        out["texte"] = f"Tu as {out['timer_seconds']} secondes pour décider."
        return out
    if tid == "T04":
        out["texte"], out["auteur"] = facts["news_text"], "Fil d'actualité"
        out["fictif"] = False  # fait réel des données, mise en forme simulée
        return out
    who = rng.choice(PROCHES if tid in ("T02", "T09") else INFLUENCEURS)
    tpl = _T.get((tid, val))
    if not tpl:
        return None
    text = tpl[level - 1].format(who=who, ret=_fr(facts["ret"]), dd=_fr(facts["dd"]), loss=_money(facts["pnl"]),
                                 p=INTENSITY.get("T03", {}).get(level), limit=_fr(facts.get("limit", 0)))
    if model is not None:
        alt = model.write_trigger({**spec, "valence": val, "famille": meta["famille"], "gabarit": text}, facts)
        if alt and alt.get("texte"):
            text = alt["texte"]
    out["texte"] = text
    out["auteur"] = who if meta["forme"] in ("publication", "message") else None
    return out


MONTHS = "janvier février mars avril mai juin juillet août septembre octobre novembre décembre".split()


def validate_trigger(trig: dict, facts: dict, episode: dict) -> list[str]:
    """Validateur : renvoie la liste des problèmes (vide = accepté)."""
    problems = []
    if trig["id"] not in TRIGGERS:
        problems.append("type de déclencheur inconnu")
    if trig["intensity"] not in (1, 2, 3):
        problems.append("intensité hors gabarit")
    low = trig["texte"].lower()
    forbidden = {episode["ticker_truth"].split(".")[0].split("-")[0].lower()}
    forbidden |= {w.lower() for w in re.findall(r"[A-Za-zÀ-ÿ]{4,}", episode["name_truth"])}
    forbidden |= set(MONTHS) | {str(y) for y in range(2019, 2028)}
    for tok in forbidden:
        if re.search(rf"(?<![a-zà-ÿ0-9]){re.escape(tok)}(?![a-zà-ÿ0-9])", low):
            problems.append(f"fuite d'identité ou de date : « {tok} »")
    allowed = {round(abs(facts[k]), 1) for k in ("ret", "dd", "limit") if k in facts}
    allowed |= {float(abs(round(facts["pnl"])))} | {float(x) for x in facts.get("news_numbers", [])}
    allowed |= {float(v) for v in INTENSITY.get(trig["id"], {}).values()}
    for raw in re.findall(r"\d[\d  ]*(?:,\d+)?", trig["texte"]):
        num = float(raw.replace(" ", "").replace(" ", "").replace(",", "."))
        if not any(abs(num - a) < 0.051 for a in allowed):
            problems.append(f"chiffre absent des faits : {raw.strip()}")
    return problems


# --------------------------------------------------------------------------- Directeur

CRASH = ["crash_no_recovery", "drop_then_recovery"]
SLOTS = {
    "RT_CONTROLE": dict(traits=["RT", "LA"], types=CRASH, plan=[None, None, None],
                        raison="mesurer la tolérance à la baisse sans aucun stimulus"),
    "LA_PERTE": dict(traits=["LA", "RT"], types=CRASH, plan=[None, "T05", "T05"],
                     raison="tester la réaction à une notification de perte en pleine baisse"),
    "HYP_ENVOLEE": dict(traits=["HYP"], types=["parabolic_rally", "rally_then_reversal"], plan=[None, "T01", "T12"],
                        raison="tester la sensibilité au hype sur un actif qui s'envole"),
    "HYP_PROCHE": dict(traits=["HYP"], types=["steady_climb", "parabolic_rally"], plan=["T02", None, "T03"],
                       raison="tester l'influence d'un proche et la preuve sociale"),
    "IMP_CHOC": dict(traits=["IMP"], types=["single_day_shock", "crash_no_recovery"], plan=["T06", None, "T06"],
                     raison="tester l'impulsivité sous pression de temps"),
    "NOUVELLES": dict(traits=["NEWS"], types=["calm_sideways", "steady_climb", "drop_then_recovery"],
                      plan=["T04", None, "T07"], raison="tester la réaction à une nouvelle fiable puis à une rumeur"),
    "DIV_LIMITE": dict(traits=["DIV"], types=["steady_climb", "parabolic_rally"], plan=["T10", None, "T10"],
                       raison="tester le respect de la limite de position déclarée"),
    "VALEURS": dict(traits=["VAL"], types=["parabolic_rally", "steady_climb"], plan=["T09", None, "T09"],
                    sector="Energy", raison="tester la cohérence avec les exclusions déclarées"),
    "DISPOSITION": dict(traits=["DISP"], types=["rally_then_reversal", "parabolic_rally", "drop_then_recovery"],
                        plan=["T11", None, "T08"], raison="tester la tendance à encaisser les gains trop tôt"),
    "CRITIQUE": dict(traits=["HYP"], types=CRASH, plan=[None, "T14", "T13"],
                     raison="tester l'esprit critique face à un message qui contredit les données"),
}
PLANS = {
    "complet": ["RT_CONTROLE", "HYP_ENVOLEE", "IMP_CHOC", "NOUVELLES", "LA_PERTE", "DIV_LIMITE", "DISPOSITION", "HYP_PROCHE"],
    "demo": ["RT_CONTROLE", "HYP_ENVOLEE", "IMP_CHOC", "NOUVELLES"],
    "demo:amira": ["LA_PERTE", "HYP_ENVOLEE", "IMP_CHOC", "DIV_LIMITE"],
    "demo:mateo": ["VALEURS", "RT_CONTROLE", "NOUVELLES", "HYP_PROCHE"],
    "demo:robert": ["HYP_ENVOLEE", "RT_CONTROLE", "NOUVELLES", "IMP_CHOC"],
}
TRAIT_SLOTS = {"RT": ["LA_PERTE", "RT_CONTROLE"], "LA": ["LA_PERTE"], "HYP": ["HYP_ENVOLEE", "CRITIQUE", "HYP_PROCHE"],
               "IMP": ["IMP_CHOC"], "NEWS": ["NOUVELLES"], "DIV": ["DIV_LIMITE"], "VAL": ["VALEURS"], "DISP": ["DISPOSITION"]}


class Director:
    """Directeur de scénarios.

    Politique locale déterministe (graine par session) : elle sert de version de base et de
    repli. Si un `model` (Bedrock) est fourni, il choisit parmi les candidats proposés ici ;
    son choix n'est accepté que s'il fait partie des candidats (sinon repli).
    Chaque décision du Directeur laisse une trace lisible (étapes observables).
    """

    def __init__(self, library: EpisodeLibrary, model=None):
        self.library = library
        self.model = model

    def initial_queue(self, declared: dict, mode: str, targets: list[str] | None = None, n: int | None = None) -> list[str]:
        if mode == "cible":
            queue = []
            for t in targets or []:
                for s in TRAIT_SLOTS.get(t, []):
                    if s not in queue and (s != "VALEURS" or declared.get("exclusions")):
                        queue.append(s)
            for s in PLANS["demo"]:
                if len(queue) >= (n or 3):
                    break
                if s not in queue:
                    queue.append(s)
            return queue[: n or 3]
        plan = PLANS.get(f"{mode}:{declared.get('persona')}", PLANS[mode])
        plan = list(plan)
        if declared.get("exclusions") and "VALEURS" not in plan:
            plan[plan.index("DISPOSITION") if "DISPOSITION" in plan else -1] = "VALEURS"
        return plan

    def next_scenario(self, session: dict, declared: dict, coverage: dict, social_followed: int) -> dict | None:
        queue = session["queue"]
        if not queue:
            return None
        # Adaptation : traiter d'abord le trait le moins couvert parmi les créneaux restants.
        def need(slot_id):
            return min(coverage.get(t, {}).get("stimulus", 0) + coverage.get(t, {}).get("controle", 0)
                       for t in SLOTS[slot_id]["traits"])
        ordered = sorted(queue, key=lambda s: (need(s), queue.index(s)))
        slot_id = ordered[0] if session["scenario_count"] > 0 else queue[0]
        slot = SLOTS[slot_id]
        rng = random.Random(f"{session['seed']}:{session['scenario_count']}")
        used_ids = set(session["used_episodes"])
        used_tickers = set(session["used_tickers"])
        cands = self.library.find(slot["types"], sector=slot.get("sector"), allow_crypto=bool(declared.get("crypto")),
                                  exclude_ids=used_ids, exclude_tickers=used_tickers)
        if not slot.get("sector"):
            excl = set(declared.get("exclusions") or [])
            cands = [c for c in cands if c["sector"] not in excl] or cands
        if not cands:
            cands = self.library.find(slot["types"], allow_crypto=True, exclude_ids=used_ids)
        if not cands:
            queue.remove(slot_id)
            return self.next_scenario(session, declared, coverage, social_followed)
        episode, source = rng.choice(cands), "politique locale"
        if self.model is not None:
            choice = self.model.choose_scenario(
                {"creneau": slot_id, "raison": slot["raison"], "couverture": coverage, "declare": declared},
                [{"episode_id": c["episode_id"], "type": c["type"], "classe": c["asset_class"],
                  "stats": c["stats"]} for c in cands[:12]])
            if choice and choice.get("episode_id") in {c["episode_id"] for c in cands}:
                episode, source = self.library.get(choice["episode_id"]), f"modèle {self.model.name}"
        queue.remove(slot_id)
        n_stops = 3  # trois arrêts par scénario, dans tous les modes
        steps = decision_steps(episode, n_stops)
        plan = list(slot["plan"])
        if n_stops == 2:  # garder un arrêt de contrôle et un arrêt avec stimulus
            stim = [p for p in plan if p]
            plan = [None, stim[0]] if stim and plan[0] is None else ([stim[0], None] if stim else [None, None])
        # Dose-réponse : si l'utilisateur a déjà suivi un stimulus social, on monte l'intensité.
        level = min(3, 1 + social_followed) if set(slot["traits"]) & {"HYP"} else 2
        triggers = {str(s): ([{"id": p, "intensity": level}] if p else []) for s, p in zip(steps, plan)}
        letter = "ABCDEFGHIJKLMNOP"[session["scenario_count"]]
        return {
            "scenario_id": f"{session['session_id']}-S{session['scenario_count'] + 1}",
            "slot": slot_id, "target_traits": slot["traits"], "episode_id": episode["episode_id"],
            "label": masked_label(episode, letter), "letter": letter, "steps": steps, "planned": triggers,
            "trace": {"composant": "Directeur de scénarios", "source": source, "creneau": slot_id,
                      "raison": slot["raison"], "couverture_avant": coverage,
                      "candidats": len(cands), "intensite": level,
                      "regles": ["jamais deux fois la même fenêtre", "au plus 2 déclencheurs par arrêt",
                                 "un arrêt de contrôle par scénario quand c'est possible"]},
        }
