import { Injectable, Logger } from '@nestjs/common';
import { config } from '../config';
import { NewsCache } from './news-cache';

/**
 * Recherche de vraies nouvelles datées dans GDELT DOC 2.0 (https://www.gdeltproject.org).
 *
 * Pourquoi GDELT : gratuit, sans clé, couvre 2017 → aujourd'hui (donc toute la période du
 * jeu de données 2021-2026) et permet de filtrer par date de publication. Les API commerciales
 * gratuites (NewsAPI, etc.) ne remontent qu'à un mois.
 * Conditions : données ouvertes, réutilisation libre avec citation de GDELT et de l'éditeur
 * (https://www.gdeltproject.org/about.html#termsofuse). On ne conserve que manchette, URL,
 * éditeur et date — jamais le texte de l'article.
 * Limite d'usage : une requête toutes les 5 secondes → file d'attente + corpus en cache.
 */
export interface Article { title: string; url: string; domain: string; seenAt: string }
export interface NewsSearch {
  ticker: string; query: string; from: string; to: string; retrievedAt: string; articles: Article[];
}

/** Termes de recherche par actif (nom courant de l'entreprise, ou marché suivi pour un FNB). */
export const NEWS_QUERIES: Record<string, string> = {
  'RY.TO': '"Royal Bank of Canada"', 'TD.TO': '("TD Bank" OR "Toronto-Dominion")', 'MFC.TO': 'Manulife',
  'ENB.TO': 'Enbridge', 'CNQ.TO': '"Canadian Natural Resources"', 'CNR.TO': '("Canadian National Railway" OR "CN Rail")',
  'FTS.TO': '"Fortis Inc"', 'ATD.TO': 'Couche-Tard', 'SHOP.TO': 'Shopify', 'CSU.TO': '"Constellation Software"',
  AAPL: '("Apple Inc" OR "Apple shares" OR "Apple stock")', MSFT: 'Microsoft', NVDA: 'Nvidia',
  GOOGL: '("Alphabet Inc" OR "Google parent")', AMZN: '("Amazon.com" OR "Amazon shares" OR "Amazon stock")',
  TSLA: 'Tesla', JPM: 'JPMorgan', JNJ: '"Johnson & Johnson"', PG: '"Procter & Gamble"', XOM: '(ExxonMobil OR "Exxon Mobil")',
  'XIU.TO': '("TSX" OR "Toronto Stock Exchange")', SPY: '("S&P 500" OR "Wall Street stocks")', QQQ: '("Nasdaq 100" OR "Nasdaq Composite")',
  ESGV: '"ESG investing"', 'XBB.TO': '("Bank of Canada" OR "Canadian bonds")', 'ZST.TO': '"Bank of Canada"',
  AGG: '"bond market"', TLT: '"Treasury yields"', GLD: '"gold prices"', 'BTC-USD': 'Bitcoin', 'ETH-USD': '(Ethereum OR Ether)',
};

const MIN_INTERVAL_MS = 5_500;
let nextSlot = 0; // file d'attente partagée : respecte la limite de GDELT

@Injectable()
export class GdeltClient {
  private log = new Logger('GDELT');
  constructor(private cache: NewsCache) {}

  /**
   * Articles publiés dans les `newsWindowDays` jours précédant `date`, jusqu'à 20 h UTC le jour même
   * (≈ clôture de New York) : l'utilisateur trade au prix de clôture, il n'a pas pu lire la suite.
   */
  async search(ticker: string, date: string, patienceMs = GdeltClient.patienceMs): Promise<NewsSearch> {
    const key = `raw/${ticker}/${date}.json`;
    const cached = await this.cache.get<NewsSearch>(key);
    if (cached) return cached;

    const query = NEWS_QUERIES[ticker];
    if (!query) throw new Error(`Aucun terme de recherche pour ${ticker}`);
    const to = new Date(`${date}T20:00:00Z`);
    const from = new Date(to.getTime() - config.newsWindowDays * 86_400_000);
    const url = 'https://api.gdeltproject.org/api/v2/doc/doc?' + new URLSearchParams({
      query: `${query} sourcelang:english`, mode: 'artlist', format: 'json', maxrecords: '75', sort: 'hybridrel',
      startdatetime: stamp(from), enddatetime: stamp(to),
    });
    const body = await this.fetchThrottled(url, Date.now() + patienceMs);
    const articles = dedupe((body.articles ?? [])
      .filter((a: any) => /^\d{8}T\d{6}Z$/.test(String(a?.seendate)) && a.url) // ignore les entrées incomplètes
      .map((a: any): Article => ({ title: clean(a.title), url: a.url, domain: a.domain, seenAt: isoFromGdelt(a.seendate) }))
      // Double vérification de la fenêtre : jamais d'article postérieur à la décision.
      .filter((a: Article) => a.title && a.seenAt >= from.toISOString() && a.seenAt <= to.toISOString()));
    const result: NewsSearch = {
      ticker, query, from: from.toISOString(), to: to.toISOString(), retrievedAt: new Date().toISOString(), articles,
    };
    await this.cache.put(key, result);
    return result;
  }

  /**
   * Temps maximal d'attente de GDELT pendant une requête de l'application. Court par défaut : en direct,
   * l'enquête ne doit pas bloquer l'utilisateur (le corpus est constitué à l'avance par
   * scripts/prefetch_news.mjs, qui augmente cette valeur).
   */
  static patienceMs = Number(process.env.GDELT_PATIENCE_MS ?? 15_000);

  /**
   * Une requête toutes les 5,5 s au minimum. GDELT répond 429 en texte brut quand il est surchargé,
   * parfois pendant plus d'une minute : on réessaie avec une attente croissante jusqu'à `deadline`.
   */
  private async fetchThrottled(url: string, deadline: number): Promise<any> {
    for (let attempt = 1; ; attempt++) {
      const wait = Math.max(0, nextSlot - Date.now());
      nextSlot = Date.now() + wait + MIN_INTERVAL_MS;
      if (wait) await new Promise((r) => setTimeout(r, wait));
      let status = 0;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
        status = res.status;
        const text = (await res.text()).trim();
        if (res.ok && text.startsWith('{')) return JSON.parse(text);
        if (res.ok && text === '') return { articles: [] }; // aucun résultat
      } catch (err) {
        status = 0; // réseau coupé, délai dépassé ou JSON tronqué : on réessaie comme pour un 429
        this.log.warn(`GDELT injoignable : ${(err as Error).message}`);
      }
      const backoff = Math.min(45_000, 10_000 * attempt);
      if (Date.now() + backoff > deadline) throw new Error(`GDELT indisponible (${status || 'réseau'})`);
      this.log.warn(`GDELT ${status || 'sans réponse'}, nouvel essai dans ${backoff / 1000} s`);
      nextSlot = Math.max(nextSlot, Date.now() + backoff);
    }
  }
}
const stamp = (d: Date) => d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
const isoFromGdelt = (s: string) => // 20230525T000000Z -> 2023-05-25T00:00:00.000Z
  `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}.000Z`;
const clean = (s: string) => String(s ?? '').replace(/\s+/g, ' ').replace(/ ([,.:;!?%)])/g, '$1').trim();

/** Les dépêches reprises par plusieurs sites ont la même manchette : on n'en garde qu'une. */
function dedupe(articles: Article[]): Article[] {
  const seen = new Set<string>();
  return articles.filter((a) => {
    const k = a.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
