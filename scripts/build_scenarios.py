"""Construit la bibliothèque de simulations à partir des prix réels (5 ans).

Usage :  python3 scripts/build_scenarios.py
Entrée : dataset/prices_daily.csv, dataset/assets_universe.csv
Sortie : data/scenarios.json, data/assets.json

Chaque scénario est une VRAIE fenêtre de marché, détectée automatiquement :
  crash   : forte baisse sur 30 séances        -> teste la réaction aux pertes
  hype    : forte hausse sur 60 séances        -> teste le FOMO
  shock   : chute brutale sur une seule séance -> teste la sensibilité aux nouvelles
  flat    : actif qui stagne pendant que le marché monte -> teste l'impulsivité
  winner  : position gagnante devenue trop grosse -> teste la concentration

Le scénario contient le contexte (90 séances avant la décision) et la suite réelle
(60 séances après). L'identité de l'actif n'est révélée qu'à la fin de l'évaluation.
Aucune cause historique n'est inventée : seuls les prix sont des faits.
"""
import csv
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTEXT, FORWARD = 90, 60          # séances avant / après la décision
MIN_GAP = 120                      # séances minimum entre deux scénarios d'un même actif
MAX_PER_TYPE = 1000                # pas de plafond artificiel : on garde tous les episodes distincts detectes

SECTOR_FR = {
    "Financials": "Finance", "Energy": "Énergie", "Industrials": "Industrie",
    "Utilities": "Services publics", "Consumer Staples": "Consommation de base",
    "Information Technology": "Technologie", "Communication Services": "Communications",
    "Consumer Discretionary": "Consommation discrétionnaire", "Health Care": "Santé",
}


def load():
    assets = {}
    with open(ROOT / "dataset/assets_universe.csv", newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            assets[r["ticker"]] = r
    prices = defaultdict(list)
    with open(ROOT / "dataset/prices_daily.csv", newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            prices[r["ticker"]].append((r["date"], float(r["adj_close"])))
    for t in prices:
        prices[t].sort()
    return assets, prices


def ret(series, a, b):
    return series[b][1] / series[a][1] - 1


def price_on(series, date):
    """Dernier prix connu à cette date (alignement de calendrier : report de la dernière valeur)."""
    last = None
    for d, p in series:
        if d > date:
            break
        last = p
    return last


def detect(kind, asset, s, t, spy):
    """Retourne un score (>0) si la séance t est une situation du type demandé, sinon None."""
    cls = asset["asset_class"]
    etf = cls.startswith("etf")
    if kind == "crash":
        r = ret(s, t - 30, t)
        return -r if r <= (-0.12 if etf else -0.25) else None
    if kind == "hype":
        r = ret(s, t - 60, t)
        return r if r >= (0.15 if etf else 0.40) else None
    if kind == "shock":
        r = ret(s, t - 1, t)
        return -r if r <= (-0.035 if etf else -0.07) else None
    if kind == "flat":
        if cls == "crypto" or asset["ticker"] == "SPY":
            return None
        a, b = price_on(spy, s[t - CONTEXT][0]), price_on(spy, s[t][0])
        if a is None or b is None:
            return None
        market = b / a - 1
        return market if abs(ret(s, t - CONTEXT, t)) <= 0.04 and market >= 0.08 else None
    if kind == "winner":
        r = ret(s, t - CONTEXT, t)
        return r if r >= (0.20 if etf else 0.50) else None
    return None


def build_scenario(kind, asset, s, t, spy, n):
    base = s[t - CONTEXT][1]
    norm = lambda i: round(s[i][1] / base * 100, 2)   # base 100 : le niveau de prix reste anonyme
    forward = [s[i][1] for i in range(t, t + FORWARD + 1)]
    peak, max_dd = forward[0], 0.0
    for p in forward:
        peak = max(peak, p)
        max_dd = min(max_dd, p / peak - 1)
    spy_a, spy_b = price_on(spy, s[t][0]), price_on(spy, s[t + FORWARD][0])
    cls = asset["asset_class"]
    label = ("Actif numérique" if cls == "crypto" else "Fonds négocié en bourse" if cls.startswith("etf")
             else "Action — " + SECTOR_FR.get(asset["sector"], asset["sector"]))
    return {
        "id": f"{kind}-{n:02d}",
        "type": kind,
        "maskLabel": label,
        "context": [norm(i) for i in range(t - CONTEXT, t + 1)],
        "forward": [norm(i) for i in range(t, t + FORWARD + 1)],
        "stats": {
            "ret1d": round(ret(s, t - 1, t), 4),
            "ret30d": round(ret(s, t - 30, t), 4),
            "ret60d": round(ret(s, t - 60, t), 4),
            "ret90d": round(ret(s, t - CONTEXT, t), 4),
        },
        "outcome": {
            "fwd20d": round(ret(s, t, t + 20), 4),
            "fwd60d": round(ret(s, t, t + FORWARD), 4),
            "maxDrawdown": round(max_dd, 4),
            "marketFwd60d": round(spy_b / spy_a - 1, 4),   # S&P 500 (SPY) sur la même période
        },
        "reveal": {
            "ticker": asset["ticker"], "name": asset["name"], "sector": asset["sector"],
            "decisionDate": s[t][0], "startDate": s[t - CONTEXT][0], "endDate": s[t + FORWARD][0],
        },
    }


def main():
    assets, prices = load()
    spy = prices["SPY"]
    library = []
    for kind in ["crash", "hype", "shock", "flat", "winner"]:
        candidates = []
        for ticker, s in prices.items():
            found = []
            for t in range(CONTEXT, len(s) - FORWARD):
                score = detect(kind, assets[ticker], s, t, spy)
                if score is not None:
                    found.append((score, t))
            # meilleurs candidats de l'actif, espacés d'au moins MIN_GAP séances (max 2 par actif)
            kept = []
            for score, t in sorted(found, reverse=True):
                if all(abs(t - k) >= MIN_GAP for _, k in kept):
                    kept.append((score, t))
                if len(kept) == 2:
                    break
            # on normalise le score par actif pour ne pas remplir la bibliothèque de crypto
            candidates += [(i, score, ticker, t) for i, (score, t) in enumerate(kept)]
        candidates.sort(key=lambda c: (c[0], -c[1]))
        for n, (_, _, ticker, t) in enumerate(candidates[:MAX_PER_TYPE], 1):
            library.append(build_scenario(kind, assets[ticker], prices[ticker], t, spy, n))

    out = ROOT / "data"
    out.mkdir(exist_ok=True)
    (out / "scenarios.json").write_text(json.dumps(library, ensure_ascii=False), encoding="utf-8")
    (out / "assets.json").write_text(
        json.dumps(list(assets.values()), ensure_ascii=False, indent=1), encoding="utf-8")
    counts = defaultdict(int)
    for sc in library:
        counts[sc["type"]] += 1
    print(f"{len(library)} scénarios :", dict(counts))
    for sc in library:
        r = sc["reveal"]
        print(f'  {sc["id"]:10s} {r["ticker"]:8s} {r["decisionDate"]}  suite 60j: {sc["outcome"]["fwd60d"]:+.0%}')


if __name__ == "__main__":
    main()
