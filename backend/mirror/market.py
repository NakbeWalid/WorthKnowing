"""Données de marché locales (CSV du jeu de départ). Implémente le port MarketData.

Règle de cohérence temporelle : pour un instant t, seules les séances strictement
antérieures au jour de t sont utilisées (la clôture du jour n'est pas encore connue).
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd


class CsvMarketData:
    def __init__(self, data_dir: str | Path):
        d = Path(data_dir)
        prices = pd.read_csv(d / "prices_daily.csv", parse_dates=["date"])
        self.adj = prices.pivot(index="date", columns="ticker", values="adj_close").sort_index()
        self.vol = prices.pivot(index="date", columns="ticker", values="volume").sort_index()
        assets = pd.read_csv(d / "assets_universe.csv")
        self.assets = {r["ticker"]: r.to_dict() for _, r in assets.iterrows()}
        fx = pd.read_csv(d / "fx_usdcad_daily.csv", parse_dates=["date"]).set_index("date")
        self.usdcad = fx["usdcad"].sort_index()
        self.first_date = self.adj.index.min()
        self.last_date = self.adj.index.max()
        self._alias = {t.replace(".TO", "").replace("-USD", ""): t for t in self.assets}

    # -- identification -------------------------------------------------
    def resolve(self, symbol: str) -> str | None:
        s = (symbol or "").upper().strip()
        if s in self.assets:
            return s
        return self._alias.get(s)

    def known(self, symbol: str) -> bool:
        return self.resolve(symbol) is not None

    def asset(self, symbol: str) -> dict | None:
        t = self.resolve(symbol)
        return self.assets.get(t) if t else None

    # -- indicateurs point-in-time --------------------------------------
    def context(self, symbol: str, at_iso: str) -> dict | None:
        t = self.resolve(symbol)
        if not t:
            return None
        day = pd.Timestamp(at_iso[:10])
        if day > self.last_date + pd.Timedelta(days=5):
            return None  # date non couverte par le jeu de données
        s = self.adj[t].dropna()
        s = s[s.index < day]
        if len(s) < 25:
            return None
        v = self.vol[t].dropna()
        v = v[v.index < day]
        rets = s.pct_change().dropna()
        last60 = s.iloc[-60:]
        vz = None
        if len(v) >= 21 and v.iloc[-21:-1].std() > 0:
            vz = float((v.iloc[-1] - v.iloc[-21:-1].mean()) / v.iloc[-21:-1].std())
        return {
            "as_of": str(s.index[-1].date()),
            "ret_5d_pct": round(float(s.iloc[-1] / s.iloc[-6] - 1) * 100, 1),
            "ret_20d_pct": round(float(s.iloc[-1] / s.iloc[-21] - 1) * 100, 1),
            "vol_20d_pct": round(float(rets.iloc[-20:].std() * np.sqrt(252)) * 100, 1),
            "volume_zscore": None if vz is None else round(vz, 1),
            "drawdown_pct": round(float(1 - s.iloc[-1] / last60.max()) * 100, 1),
            "source": "jeu de données (prices_daily.csv, adj_close)",
        }

    def path(self, symbol: str, start: str, end: str) -> list[float]:
        t = self.resolve(symbol)
        s = self.adj[t].dropna()
        s = s[(s.index >= pd.Timestamp(start)) & (s.index <= pd.Timestamp(end))]
        if t.endswith("-USD"):
            s = s[s.index.dayofweek < 5]
        return [round(float(x), 2) for x in (s / s.iloc[0] * 100)]

    def fx_usdcad(self, at_iso: str) -> float:
        day = pd.Timestamp(at_iso[:10])
        s = self.usdcad[self.usdcad.index <= day]
        return float(s.iloc[-1]) if len(s) else float(self.usdcad.iloc[0])

    def to_cad(self, amount: float, currency: str, at_iso: str) -> float:
        return amount * self.fx_usdcad(at_iso) if (currency or "CAD").upper() == "USD" else amount
