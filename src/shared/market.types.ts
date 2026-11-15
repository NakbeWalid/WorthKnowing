/** Contexte de marché calculé à une date donnée (faits issus de dataset/prices_daily.csv). */
export interface MarketContext {
  ticker: string;
  name: string;
  assetClass: string;
  sector: string;
  date: string;
  price: number;
  currency: string;
  ret1d: number;
  ret5d: number;
  ret30d: number;
  ret90d: number;
  /** Volatilité annualisée sur 30 séances. */
  vol30d: number;
  /** Écart par rapport au plus haut des 90 dernières séances (≤ 0). */
  drawdown90d: number;
  speculative: boolean;
}
