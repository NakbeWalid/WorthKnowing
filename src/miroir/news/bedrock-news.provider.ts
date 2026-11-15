import { Injectable, Logger } from '@nestjs/common';
import { BedrockClient } from '../ai/bedrock.client';
import { config } from '../config';
import { MarketContext, NewsItem } from '../domain/types';
import { Article, GdeltClient } from './gdelt.client';
import { NewsCache } from './news-cache';
import { MockNewsProvider, NewsProvider } from './news.provider';

const IMPACTS = ['faible', 'moyen', 'élevé'] as const;
const MAX_ARTICLES_TO_MODEL = 25;
const MAX_ITEMS = 5;

const SYSTEM = `Tu es l'agent de nouvelles de Miroir, un outil éducatif de SIMULATION d'investissement (aucun conseil financier).
Tu reçois une liste numérotée de manchettes RÉELLES et datées. Règles absolues :
- Tu n'inventes jamais de nouvelle, de fait, de chiffre ni de cause. Tu ne t'appuies que sur les manchettes fournies.
- Tu ne cites une manchette que par son numéro.
- Si aucune manchette ne concerne l'actif, tu réponds avec une liste vide.
Tu réponds uniquement par un objet JSON, sans texte autour.`;

/**
 * Agent de nouvelles (Amazon Bedrock).
 *   1. récupère les vraies manchettes des 7 jours précédant la date (GDELT, fenêtre bornée par le code) ;
 *   2. le modèle garde celles qui concernent l'actif, les classe (impact) et les reformule en français ;
 *   3. le code vérifie chaque réponse : seuls les numéros existants sont acceptés, rien n'est ajouté.
 * Aucune manchette trouvée → [] (« aucun signal »). Erreur GDELT ou Bedrock → repli sur le mock (étiqueté simulé).
 */
@Injectable()
export class BedrockNewsProvider extends NewsProvider {
  private log = new Logger('BedrockNews');
  private fallback = new MockNewsProvider();

  constructor(private gdelt: GdeltClient, private bedrock: BedrockClient, private cache: NewsCache) {
    super();
  }

  /** Requêtes en cours par clé : deux trades simultanés sur le même actif ne lancent qu'une recherche. */
  private inFlight = new Map<string, Promise<NewsItem[]>>();
  async getNews(c: MarketContext): Promise<NewsItem[]> {
    try {
      return await withTimeout(this.realNews(c), config.newsTimeoutMs);
    } catch (err) {
      this.log.warn(`${c.ticker} ${c.date} : ${(err as Error).message} — repli sur les signaux simulés`);
      return this.fallback.getNews(c);
    }
  }
  /**
   * Vraies nouvelles uniquement ; lève une erreur si GDELT ou Bedrock échoue (rien n'est alors mis en cache).
   * Si l'utilisateur n'attend plus (délai dépassé), la recherche se termine en arrière-plan et alimente le cache.
   */
  private realNews(c: MarketContext): Promise<NewsItem[]> {
    const key = `classified/${slug(this.bedrock.modelId)}/${c.ticker}/${c.date}.json`;
    let pending = this.inFlight.get(key);
    if (!pending) {
      pending = this.fetchNews(c, key).finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, pending);
    }
    return pending;
  }
  private async fetchNews(c: MarketContext, key: string): Promise<NewsItem[]> {
    const cached = await this.cache.get<NewsItem[]>(key);
    if (cached) return cached;
    const search = await this.gdelt.search(c.ticker, c.date);
    const articles = search.articles.slice(0, MAX_ARTICLES_TO_MODEL);
    const items = articles.length ? await this.classify(c, articles, search.retrievedAt) : [];
    await this.cache.put(key, items);
    return items;
  }
  private async classify(c: MarketContext, articles: Article[], retrievedAt: string): Promise<NewsItem[]> {
    const list = articles.map((a, i) => `[${i + 1}] ${a.seenAt.slice(0, 10)} · ${a.domain} · ${a.title}`).join('\n');
    const prompt = `Actif : ${c.name} (${c.ticker}), classe ${c.assetClass}, secteur ${c.sector}.
Date de la décision de l'investisseur : ${c.date} (les manchettes sont toutes antérieures).

Manchettes :
${list}

Tâche : garde au plus ${MAX_ITEMS} manchettes qui parlent directement de cet actif (ou, pour un fonds, du marché qu'il suit).
Pour chacune :
- "id" : son numéro ;
- "impact" : "faible", "moyen" ou "élevé" = capacité de la manchette à faire réagir un investisseur particulier (emballement, peur) ;
- "resume" : la manchette reformulée en français, 25 mots maximum, SANS aucune information absente de la manchette.
Format : {"items":[{"id":1,"impact":"moyen","resume":"..."}]}`;
    const out = await this.bedrock.json<{ items?: { id: unknown; impact: unknown; resume: unknown }[] }>(SYSTEM, prompt, 900);

    const used = new Set<number>();
    const items: NewsItem[] = [];
    for (const it of out.items ?? []) {
      const id = Number(it.id);
      const article = articles[id - 1];
      // Garde-fou : on rejette toute référence à une manchette inexistante ou en double.
      if (!Number.isInteger(id) || !article || used.has(id) || !IMPACTS.includes(it.impact as any)) continue;
      used.add(id);
      items.push({
        date: article.seenAt.slice(0, 10), title: article.title, source: article.domain, url: article.url,
        impact: it.impact as NewsItem['impact'], simulated: false, retrievedAt,
        summary: typeof it.resume === 'string' ? it.resume.slice(0, 240) : undefined,
      });
    }
    const rank = (n: NewsItem) => IMPACTS.indexOf(n.impact);
    return items.sort((a, b) => rank(b) - rank(a) || b.date.localeCompare(a.date)).slice(0, MAX_ITEMS);
  }
}

const slug = (s: string) => s.replace(/[^a-zA-Z0-9-]/g, '_');
/** Abandonne l'attente après `ms` (la promesse d'origine continue, son échec éventuel est déjà journalisé par l'appelant). */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`délai de ${Math.round(ms / 1000)} s dépassé`)), ms);
  });
  // Évite un « unhandledRejection » si la recherche échoue après l'abandon de l'attente.
  promise.catch(() => undefined);
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
