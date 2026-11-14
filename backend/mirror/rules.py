"""Pacte : traduction du texte de l'utilisateur en règle structurée, et garde-fou (appariement).

Le système ne propose JAMAIS le contenu d'une règle. Il traduit ce que l'utilisateur écrit,
et pose une question neutre si le texte n'est pas mesurable. L'appariement est déterministe.
"""
from __future__ import annotations

import re
import uuid

from .simulation import now_iso

FEATURES_FR = {"ret_5d_pct": "hausse sur 5 jours", "ret_20d_pct": "hausse sur 20 jours", "drawdown_pct": "baisse sous le sommet récent",
               "hype_flag": "actif très discuté", "hours_since_loss": "heures depuis une perte", "asset_class": "classe d'actif",
               "vol_20d_pct": "volatilité sur 20 jours"}
_PCT = r"(\d+(?:[.,]\d+)?)\s*%"


def _f(s: str) -> float:
    return float(s.replace(",", "."))


def parse_rule_text(text: str) -> dict:
    """Traduction locale par motifs. Renvoie {ok, trigger, action} ou {ok: False, question}."""
    t = " " + text.lower().strip() + " "
    conds, action = [], None
    classes = []
    if re.search(r"crypto", t):
        classes.append("crypto")
    if re.search(r"\baction", t):
        classes.append("equity")
    m = re.search(r"(?:mont|hauss|grimp|pris|gagn|bond)\w*[^.%]*?" + _PCT + r"[^.]*?(\d+)\s*(jours?|j\b|semaines?|mois)", t)
    if m:
        days = int(m.group(2)) * (7 if m.group(3).startswith("sem") else 30 if m.group(3) == "mois" else 1)
        conds.append({"feature": "ret_5d_pct" if days <= 7 else "ret_20d_pct", "op": ">", "value": _f(m.group(1))})
    m = re.search(r"(?:baiss|perd|chut|recul|tomb)\w*[^.%]*?" + _PCT, t)
    if m and not any(c["feature"].startswith("ret_") for c in conds):
        conds.append({"feature": "drawdown_pct", "op": ">", "value": _f(m.group(1))})
    if re.search(r"influenceur|réseaux|reseaux|tweet|tout le monde en parle|populaire|buzz|hype|à la mode|a la mode", t):
        conds.append({"feature": "hype_flag", "op": "==", "value": True})
    if re.search(r"après une perte|apres une perte|me refaire", t):
        conds.append({"feature": "hours_since_loss", "op": "<", "value": 24})
    m = re.search(r"(?:attend\w*|patient\w*|pas avant|délai de|delai de)\s*(?:au moins\s*)?(\d+)\s*(h\b|heures?|jours?|j\b|semaines?)", t)
    if m:
        unit = m.group(2)
        hours = int(m.group(1)) * (1 if unit.startswith("h") else 168 if unit.startswith("sem") else 24)
        action = {"type": "cooldown", "params": {"hours": hours}}
        if re.search(r"(avant de|pour) (re)?vendre", t):
            action["params"]["side"] = "sell"
        elif re.search(r"(avant d'|pour )(en )?(r)?acheter", t):
            action["params"]["side"] = "buy"
    m = re.search(r"(?:jamais plus de|pas plus de|maximum|max\.?|au plus|limite\w* à|limite\w* a)\s*(?:de\s*)?" + _PCT, t)
    if m and action is None:
        action = {"type": "max_weight", "params": {"pct": _f(m.group(1))}}
        conds = [c for c in conds if c["feature"] != "drawdown_pct"]
    m = re.search(r"(?:jamais plus de|pas plus de|maximum|max\.?|au plus)\s*(?:de\s*)?(\d[\d\s]*)\s*\$", t)
    if m and action is None:
        action = {"type": "size_cap", "params": {"amount": float(re.sub(r"\s", "", m.group(1)))}}
    if action is None and re.search(r"je n'ach[eè]te pas|je n'ach[eè]terai pas|n'ach[eè]te jamais|ne pas acheter", t) and conds:
        action = {"type": "no_buy_on_trigger", "params": {}}
    if action is None and re.search(r"je ne vends pas|je ne vendrai pas|ne pas vendre", t) and conds:
        action = {"type": "no_sell_on_trigger", "params": {}}
    if classes:
        conds.append({"feature": "asset_class", "op": "in", "value": classes})
    measurable = [c for c in conds if c["feature"] != "asset_class"]
    if action is None and not measurable:
        return {"ok": False, "question": "Ta règle n'est pas encore mesurable. Dans quelle situation précise s'applique-t-elle "
                                         "(un pourcentage de hausse ou de baisse, sur combien de jours) et que feras-tu alors "
                                         "(attendre combien de temps, limiter à quel pourcentage) ?"}
    if action is None:
        return {"ok": False, "question": "Que feras-tu exactement dans cette situation : attendre combien de temps, "
                                         "limiter à quel pourcentage ou à quel montant, ne pas acheter, ne pas vendre ?"}
    if action["type"] in ("cooldown", "no_buy_on_trigger", "no_sell_on_trigger") and not measurable:
        return {"ok": False, "question": "Dans quelle situation mesurable cette règle s'applique-t-elle "
                                         "(une hausse ou une baisse de combien de pour cent, en combien de jours) ?"}
    return {"ok": True, "trigger": {"all": conds}, "action": action}


def describe(rule: dict) -> str:
    """« Voici comment je comprends ta règle » : lecture fidèle de la structure, sans ajout."""
    parts = []
    for c in rule["trigger"]["all"]:
        if c["feature"] == "asset_class":
            names = {"crypto": "cryptoactifs", "equity": "actions"}
            parts.append("pour les " + " et les ".join(names.get(v, v) for v in c["value"]))
        elif c["feature"] == "hype_flag":
            parts.append("quand l'actif est très discuté")
        elif c["feature"] == "hours_since_loss":
            parts.append(f"dans les {c['value']} heures qui suivent une perte")
        else:
            parts.append(f"quand la {FEATURES_FR[c['feature']]} dépasse {str(c['value']).rstrip('0').rstrip('.').replace('.', ',')} %")
    a, p = rule["action"]["type"], rule["action"]["params"]
    act = {"cooldown": f"attendre {p.get('hours')} heures avant " + {"sell": "de vendre", "buy": "d'acheter"}.get(p.get("side"), "d'agir"),
           "max_weight": f"ne jamais dépasser {str(p.get('pct')).rstrip('0').rstrip('.').replace('.', ',')} % du portefeuille dans un même actif",
           "size_cap": f"ne jamais dépasser {round(p.get('amount', 0))} $ par opération",
           "no_buy_on_trigger": "ne pas acheter", "no_sell_on_trigger": "ne pas vendre",
           "require_ack": "confirmer explicitement avant d'agir"}[a]
    return (", ".join(parts) + " : " if parts else "En tout temps : ") + act + "."


def translate(text: str, weakness: dict | None, model=None) -> dict:
    """Traduit le texte de l'utilisateur. Un modèle (Bedrock) peut aider, mais sa sortie doit
    être une structure valide ; sinon on revient aux motifs locaux."""
    res = None
    if model is not None:
        cand = model.parse_rule(text, weakness or {})
        if cand and cand.get("ok") and valid_structure(cand):
            res = cand
    res = res or parse_rule_text(text)
    if res["ok"]:
        res["lecture"] = describe(res)
    return res


def valid_structure(r: dict) -> bool:
    try:
        ok_a = r["action"]["type"] in ("cooldown", "max_weight", "size_cap", "no_buy_on_trigger", "no_sell_on_trigger", "require_ack")
        ok_c = all(c["feature"] in FEATURES_FR and c["op"] in (">", "<", "==", "in") for c in r["trigger"]["all"])
        return ok_a and ok_c
    except (KeyError, TypeError):
        return False


def new_rule(user_id: str, text: str, parsed: dict, trait: str | None, origin: dict, strictness: int = 1, version: int = 1) -> dict:
    return {"rule_id": "R-" + uuid.uuid4().hex[:8], "profile_id": user_id, "version": version, "strictness": int(strictness),
            "text_user": text, "trait": trait, "trigger": parsed["trigger"], "action": parsed["action"],
            "lecture": describe(parsed), "origin": origin, "created_at": now_iso(), "active": True}


# --------------------------------------------------------------------------- garde-fou

def _cond(c: dict, ctx: dict):
    """True / False / None (inconnu)."""
    v = ctx.get(c["feature"])
    if v is None:
        return None
    if c["op"] == ">":
        return v > c["value"]
    if c["op"] == "<":
        return v < c["value"]
    if c["op"] == "==":
        return v == c["value"]
    return v in c["value"]


def match_rules(rules: list[dict], ctx: dict, side: str, amount_cad: float | None) -> list[dict]:
    """Appariement déterministe d'un contexte de trade avec les règles actives de l'utilisateur."""
    out = []
    for r in rules:
        if not r.get("active"):
            continue
        a = r["action"]
        if a["type"] == "no_sell_on_trigger" and side != "sell":
            continue
        if a["type"] in ("no_buy_on_trigger", "max_weight", "size_cap") and side != "buy":
            continue
        if a["type"] == "cooldown" and a["params"].get("side") not in (None, side):
            continue
        res = [_cond(c, ctx) for c in r["trigger"]["all"]]
        if any(x is False for x in res):
            # Règle approchante : une seule condition numérique manquée de moins de 20 %.
            near = [c for c, x in zip(r["trigger"]["all"], res) if x is False and c["op"] == ">" and
                    ctx.get(c["feature"]) is not None and ctx[c["feature"]] >= 0.8 * c["value"]]
            if len(near) == sum(1 for x in res if x is False) == 1:
                out.append({"rule": r, "statut": "approchante", "similarite": round(ctx[near[0]["feature"]] / near[0]["value"], 2),
                            "violation": False, "inconnus": [], "version_compatible": None})
            continue
        unknown = [c["feature"] for c, x in zip(r["trigger"]["all"], res) if x is None]
        if unknown:
            out.append({"rule": r, "statut": "indéterminée", "similarite": None, "violation": False, "inconnus": unknown,
                        "version_compatible": None})
            continue
        violation, compat = True, None
        if a["type"] == "max_weight":
            w, pv = ctx.get("position_weight_after_pct"), ctx.get("portfolio_value")
            if w is None:
                out.append({"rule": r, "statut": "indéterminée", "similarite": None, "violation": False,
                            "inconnus": ["position_weight_after_pct"], "version_compatible": None})
                continue
            violation = w > a["params"]["pct"]
            if violation and pv and amount_cad is not None:
                before = max(0.0, w / 100 * pv - amount_cad)
                compat = {"montant": max(0, round(a["params"]["pct"] / 100 * pv - before)), "devise": "CAD",
                          "explication": f"montant qui garde la position à {a['params']['pct']:g} % du portefeuille"}
            if not violation:
                continue
        elif a["type"] == "size_cap":
            violation = amount_cad is not None and amount_cad > a["params"]["amount"]
            if not violation:
                continue
            compat = {"montant": round(a["params"]["amount"]), "devise": "CAD", "explication": "montant maximal de ta règle"}
        elif a["type"] == "cooldown":
            compat = {"attendre_heures": a["params"]["hours"], "explication": "délai que tu t'es fixé dans cette situation"}
        out.append({"rule": r, "statut": "applicable", "similarite": 1.0, "violation": violation, "inconnus": [],
                    "version_compatible": compat})
    return out
