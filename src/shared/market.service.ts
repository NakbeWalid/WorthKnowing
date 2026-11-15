import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { MarketContext } from './market.types';
import { readDataFile } from './data-files';

interface Asset { ticker: string; name: string; asset_class: string; currency: string; sector: string }
interface Series { dates: string[]; close: number[]; adj: number[] }

/**
 * Données de marché : charge dataset/prices_daily.csv en mémoire (≈ 40 000 lignes).
 * `close` sert de prix d'exécution, `adj_close` sert aux rendements (voir dataset/README.md).
 * Lu au démarrage depuis S3 si DATA_BUCKET est défini (repli sur le disque local), voir data-files.ts.
 */
@Injectable()
export class MarketService implements OnModuleInit {
  private assets: Asset[] = [];
  private series = new Map<string, Series>();
  lastDate = '';
  /** Première date où chaque actif a les 90 séances d'historique exigées par context(). */
  firstDate = '';

  async onModuleInit() {
    this.assets = JSON.parse(await readDataFile('data/assets.json'));
    const lines = (await readDataFile('dataset/prices_daily.csv')).trim().split('\n');
    for (const line of lines.slice(1)) {
      // date,ticker,open,high,low,close,adj_close,volume,currency
      const c = line.split(',');
      if (!this.series.has(c[1])) this.series.set(c[1], { dates: [], close: [], adj: [] });
      const s = this.series.get(c[1])!;
      s.dates.push(c[0]); s.close.push(Number(c[5])); s.adj.push(Number(c[6]));
    }
    const calendar = this.series.get('SPY')!.dates;
    this.lastDate = calendar.at(-1)!;
    this.firstDate = calendar[95];
  }

  listAssets() { return this.assets; }

  /** Prix d'exécution : dernière clôture connue à la date demandée (report de la dernière valeur). */
  priceAt(ticker: string, date: string) {
    const { series, i } = this.locate(ticker, date);
    return series.close[i];
  }

  /** Indicateurs factuels autour de la date du trade. */
  context(ticker: string, date: string): MarketContext {
    const asset = this.assets.find((a) => a.ticker === ticker)!;
    const { series, i } = this.locate(ticker, date);
    if (i < 90) throw new BadRequestException('Pas assez d’historique avant cette date (90 séances requises).');
    const adj = series.adj;
    const ret = (n: number) => adj[i] / adj[i - n] - 1;
    const daily = Array.from({ length: 30 }, (_, k) => Math.log(adj[i - k] / adj[i - k - 1]));
    const mean = daily.reduce((a, b) => a + b, 0) / daily.length;
    const variance = daily.reduce((a, b) => a + (b - mean) ** 2, 0) / (daily.length - 1);
    const sessionsPerYear = asset.asset_class === 'crypto' ? 365 : 252;
    const vol30d = Math.sqrt(variance * sessionsPerYear);
    const high90 = Math.max(...adj.slice(i - 90, i + 1));
    return {
      ticker, name: asset.name, assetClass: asset.asset_class, sector: asset.sector, currency: asset.currency,
      date: series.dates[i], price: series.close[i],
      ret1d: ret(1), ret5d: ret(5), ret30d: ret(30), ret90d: ret(90),
      vol30d, drawdown90d: adj[i] / high90 - 1,
      // Hypothèse : « spéculatif » = cryptoactif ou volatilité annualisée ≥ 45 %.
      speculative: asset.asset_class === 'crypto' || vol30d >= 0.45,
    };
  }

  /** Les `n` dernières clôtures jusqu'à `date` incluse (graphiques côté navigateur). */
  history(ticker: string, date: string, n = 90) {
    const { series, i } = this.locate(ticker, date);
    const from = Math.max(0, i - n + 1);
    return { dates: series.dates.slice(from, i + 1), close: series.close.slice(from, i + 1) };
  }

  /** Séances du calendrier de référence (SPY) entre deux dates incluses. */
  sessions(from: string, to: string) {
    return this.series.get('SPY')!.dates.filter((d) => d >= from && d <= to);
  }

  private locate(ticker: string, date: string) {
    const series = this.series.get(ticker);
    if (!series) throw new BadRequestException(`Actif inconnu : ${ticker}`);
    let i = series.dates.length - 1;
    while (i >= 0 && series.dates[i] > date) i--;
    if (i < 0) throw new BadRequestException('Aucun prix disponible à cette date.');
    return { series, i };
  }
}
