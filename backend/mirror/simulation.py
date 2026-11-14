"""Moteur de session : arrêts, décisions, capture des signaux. Rien n'est révélé avant la fin."""
from __future__ import annotations

import random
import time
import uuid

from .scenarios import (NEWS_IDS, SOCIAL_IDS, TRIGGERS, Director, _fr, render_trigger,
                        trigger_applicable, validate_trigger)

ACTIONS = ("hold", "sell", "add")
ADD_FRACTION = 0.25  # HYPOTHÈSE : « renforcer » ajoute 25 % de la valeur de la position


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


class SimulationEngine:
    def __init__(self, repo, library, market, director: Director, cfg: dict, model=None):
        self.repo, self.library, self.market, self.director, self.cfg, self.model = repo, library, market, director, cfg, model
        alloc = cfg["allocations"]
        self.capital = alloc["capital"]
        self.v0 = self.capital * alloc["focus_weight_pct"] / 100
        self.cash0 = self.capital * alloc["cash_pct"] / 100

    # ------------------------------------------------------------------ création
    def start(self, user: dict, mode: str, targets: list[str] | None = None, seed: str | None = None) -> dict:
        declared = user["declared"]
        sid = "SES-" + uuid.uuid4().hex[:8]
        n = {"complet": self.cfg["episodes"]["full_mode_scenarios"], "demo": self.cfg["episodes"]["demo_mode_scenarios"],
             "cible": self.cfg["episodes"]["targeted_mode_scenarios"]}[mode]
        session = {
            "session_id": sid, "user_id": user["user_id"], "mode": mode, "targets": targets or [],
            "seed": seed or uuid.uuid4().hex, "created_at": now_iso(), "status": "active",
            "queue": self.director.initial_queue(declared, mode, targets, n)[:n],
            "scenario_count": 0, "used_episodes": list(user.get("used_episodes", [])), "used_tickers": [],
            "scenarios": [], "decisions": [], "director_trace": [],
        }
        session["scenarios_total"] = len(session["queue"])
        self._open_next(session, declared)
        self.repo.put("sessions", sid, session)
        return session

    def _coverage(self, session: dict) -> dict:
        cov: dict[str, dict] = {}
        for d in session["decisions"]:
            if d["trigger_ids"]:
                for tid in d["trigger_ids"]:
                    cov.setdefault(TRIGGERS[tid]["trait"], {"stimulus": 0, "controle": 0})["stimulus"] += 1
            else:
                for t in d["target_traits"]:
                    cov.setdefault(t, {"stimulus": 0, "controle": 0})["controle"] += 1
        return cov

    def _open_next(self, session: dict, declared: dict) -> None:
        followed = sum(1 for d in session["decisions"] if d.get("aligned") and set(d["trigger_ids"]) & SOCIAL_IDS)
        sc = self.director.next_scenario(session, declared, self._coverage(session), followed)
        if sc is None:
            session["status"] = "finished"
            session["finished_at"] = now_iso()
            return
        ep = self.library.get(sc["episode_id"])
        sc.update({"stop_idx": 0, "units": 1.0, "cash": self.cash0, "ended": False, "sold_step": None,
                   "shown": {}, "recognition": None, "adds": []})
        session["scenarios"].append(sc)
        session["scenario_count"] += 1
        session["used_episodes"].append(ep["episode_id"])
        session["used_tickers"].append(ep["ticker_truth"])
        session["director_trace"].append(sc["trace"])
        session["status"] = "active"

    # ------------------------------------------------------------------ état d'un arrêt
    def _facts(self, sc: dict, ep: dict, declared: dict) -> dict:
        step = sc["steps"][sc["stop_idx"]]
        cp = ep["checkpoints"][step]
        pos = self.v0 * sc["units"] * cp["index"] / 100
        invested = self.v0 + sum(a["amount"] for a in sc["adds"])
        prev_step = sc["steps"][sc["stop_idx"] - 1] if sc["stop_idx"] > 0 else 0
        prev = ep["checkpoints"][prev_step]["macro"]
        cur = cp["macro"]
        key = "V39079" if ep["currency"] == "CAD" else "DFF"
        bank = "La Banque du Canada" if key == "V39079" else "La Réserve fédérale américaine"
        news_text = news_val = None
        nums: list[float] = []
        a, b = prev.get(key), cur.get(key)
        if a is not None and b is not None and abs(b - a) >= 0.2:
            verb = "relevé" if b > a else "abaissé"
            news_text = f"{bank} a {verb} son taux directeur de {_fr(a)} % à {_fr(b)} %."
            news_val, nums = ("sell" if b > a else "buy"), [a, b]
        elif cur.get("STATIC_TOTALCPICHANGE") is not None:
            x = cur["STATIC_TOTALCPICHANGE"]
            news_text = f"L'inflation sur un an au Canada est publiée à {_fr(x)} %."
            news_val, nums = ("sell" if x >= 3 else "buy"), [x]
        limit = self.cfg["allocations"]["position_limit_pct"][declared["risque"]]
        return {"step": step, "ret": cp["ret_since_start_pct"], "dd": cp["drawdown_from_peak_pct"],
                "pos": pos, "pnl": pos - invested, "invested": invested, "limit": limit,
                "news_text": news_text, "news_valence": news_val, "news_numbers": nums, "macro": cur}

    def _triggers_for_stop(self, session: dict, sc: dict, ep: dict, facts: dict) -> list[dict]:
        key = str(facts["step"])
        if key in sc["shown"]:
            return sc["shown"][key]
        rng = random.Random(f"{session['seed']}:{sc['scenario_id']}:{key}")
        shown, log = [], []
        for spec in sc["planned"].get(key, [])[:2]:
            if not trigger_applicable(spec["id"], facts):
                log.append({"declencheur": spec["id"], "resultat": "non applicable à cet arrêt, remplacé par un contrôle"})
                continue
            trig = render_trigger(spec, facts, rng, self.model)
            problems = ["aucun gabarit"] if trig is None else validate_trigger(trig, facts, ep)
            if problems and self.model is not None:  # repli sur le gabarit local
                trig = render_trigger(spec, facts, rng, None)
                problems = ["aucun gabarit"] if trig is None else validate_trigger(trig, facts, ep)
            if problems:
                log.append({"declencheur": spec["id"], "resultat": "rejeté par le Validateur", "problemes": problems})
                continue
            log.append({"declencheur": spec["id"], "resultat": "accepté par le Validateur"})
            shown.append(trig)
        sc["shown"][key] = shown
        sc.setdefault("validation_log", {})[key] = log
        return shown

    def view(self, session: dict, declared: dict) -> dict:
        """Vue MASQUÉE envoyée au navigateur : aucun nom, ticker, date ni suite du marché."""
        base = {"session_id": session["session_id"], "status": session["status"], "mode": session["mode"],
                "scenarios_total": session["scenarios_total"], "scenario_number": session["scenario_count"]}
        if session["status"] == "finished":
            return base
        sc = session["scenarios"][-1]
        if session["status"] == "awaiting_recognition":
            return {**base, "label": sc["label"], "scenario_id": sc["scenario_id"]}
        ep = self.library.get(sc["episode_id"])
        f = self._facts(sc, ep, declared)
        trigs = self._triggers_for_stop(session, sc, ep, f)
        sc.setdefault("displayed_at", {})[str(f["step"])] = time.time()
        self.repo.put("sessions", session["session_id"], session)
        path = self.market.path(ep["ticker_truth"], ep["start"], ep["end"])
        n_points = min(len(path), f["step"] * 21 + 1)
        other = self.capital - self.v0 - self.cash0
        text_len = sum(len(t["texte"]) for t in trigs)
        imp = self.cfg["scoring"]["imp"]
        m = f["macro"]
        cad = ep["currency"] == "CAD"
        return {**base, "scenario_id": sc["scenario_id"], "label": sc["label"],
                "month": f["step"], "months_total": len(ep["checkpoints"]) - 1,
                "stop_number": sc["stop_idx"] + 1, "stops_total": len(sc["steps"]),
                "chart": path[:n_points],
                "position_value": round(f["pos"]), "position_pnl": round(f["pnl"]),
                "position_ret_pct": f["ret"], "drawdown_pct": f["dd"],
                "cash": round(sc["cash"]), "portfolio_value": round(other + sc["cash"] + f["pos"]),
                "portfolio_pnl": round(other + sc["cash"] + f["pos"] - self.capital),
                "position_weight_pct": round(f["pos"] / (other + sc["cash"] + f["pos"]) * 100, 1),
                "limit_pct": f["limit"],
                "macro": {"taux_directeur": m.get("V39079" if cad else "DFF"),
                          "taux_10_ans": m.get("BD.CDN.10YR.DQ.YLD" if cad else "DGS10"),
                          "inflation_canada": m.get("STATIC_TOTALCPICHANGE"),
                          "zone": "Canada" if cad else "États-Unis"},
                "triggers": [{k: t[k] for k in ("id", "forme", "auteur", "texte", "timer_seconds", "famille")} for t in trigs],
                "reading_time_expected_ms": imp["base_reading_ms"] + imp["ms_per_char"] * text_len,
                "can_add": sc["cash"] >= 1}

    # ------------------------------------------------------------------ décision
    def decide(self, session: dict, declared: dict, action: str, decision_time_ms: int, hesitations: int = 0) -> dict:
        if session["status"] != "active":
            raise ValueError("Aucune décision attendue pour cette session.")
        if action not in ACTIONS:
            raise ValueError("Action inconnue.")
        sc = session["scenarios"][-1]
        ep = self.library.get(sc["episode_id"])
        f = self._facts(sc, ep, declared)
        trigs = self._triggers_for_stop(session, sc, ep, f)
        other = self.capital - self.v0 - self.cash0
        weight_before = f["pos"] / (other + sc["cash"] + f["pos"]) * 100
        if action == "add":
            amount = min(ADD_FRACTION * f["pos"], sc["cash"])
            if amount < 1:
                action = "hold"
            else:
                price = self.v0 * ep["checkpoints"][f["step"]]["index"] / 100
                sc["units"] += amount / price
                sc["cash"] -= amount
                sc["adds"].append({"step": f["step"], "amount": round(amount, 2)})
        pos_after = self.v0 * sc["units"] * ep["checkpoints"][f["step"]]["index"] / 100
        if action == "sell":
            sc["cash"] += pos_after
            sc["units"], sc["sold_step"], pos_after = 0.0, f["step"], 0.0
        weight_after = pos_after / (other + sc["cash"] + pos_after) * 100
        valences = [t["valence"] for t in trigs if t["valence"] in ("buy", "sell")]
        aligned = None
        if valences:
            aligned = any((v == "buy" and action == "add") or (v == "sell" and action == "sell") for v in valences)
        imp = self.cfg["scoring"]["imp"]
        d = {
            "decision_id": f"D-{session['session_id'][4:]}-{len(session['decisions']) + 1}",
            "session_id": session["session_id"], "scenario_id": sc["scenario_id"], "step": f["step"],
            "stop_number": sc["stop_idx"] + 1, "action": action, "t_decision": now_iso(),
            "decision_time_ms": int(decision_time_ms), "hesitation_events": int(hesitations),
            "reading_time_expected_ms": imp["base_reading_ms"] + imp["ms_per_char"] * sum(len(t["texte"]) for t in trigs),
            "trigger_ids": [t["id"] for t in trigs], "trigger_intensity": max([t["intensity"] for t in trigs], default=0),
            "trigger_families": [t["famille"] for t in trigs], "valences": valences, "aligned": aligned,
            "target_traits": sc["target_traits"], "ret_since_start": f["ret"], "drawdown_from_peak": f["dd"],
            "position_pnl": round(f["pnl"]), "focus_position_value": round(f["pos"]),
            "portfolio_value": round(other + sc["cash"] + pos_after),
            "position_weight_before": round(weight_before, 1), "position_weight": round(weight_after, 1),
            "limit_pct": f["limit"], "macro_snapshot": f["macro"], "order_index": len(session["decisions"]) + 1,
            "recognition_flag": None, "episode_sector": ep["sector"],
        }
        session["decisions"].append(d)
        sc["stop_idx"] += 1
        if action == "sell" or sc["stop_idx"] >= len(sc["steps"]):
            sc["ended"] = True
            session["status"] = "awaiting_recognition"
        self.repo.put("sessions", session["session_id"], session)
        return d

    def recognition(self, session: dict, declared: dict, answer: str) -> None:
        if session["status"] != "awaiting_recognition":
            raise ValueError("Aucune question de reconnaissance en attente.")
        if answer not in ("oui", "peut-etre", "non"):
            raise ValueError("Réponse inconnue.")
        sc = session["scenarios"][-1]
        sc["recognition"] = answer
        for d in session["decisions"]:
            if d["scenario_id"] == sc["scenario_id"]:
                d["recognition_flag"] = answer
        self._open_next(session, declared)
        self.repo.put("sessions", session["session_id"], session)
