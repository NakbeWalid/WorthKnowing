import { Injectable } from '@nestjs/common';
import { HistoricalContext, MarketContext, NewsItem, pct } from '../domain/types';

/**
 * Contrat de l'agent de recherche de nouvelles utilisé pendant l'enquête d'un trade.
 * Implémentation AWS : `BedrockNewsProvider` (bedrock-news.provider.ts), choisie par NEWS_DRIVER=bedrock.
 */
export abstract class NewsProvider {
  /** Nouvelles publiées avant la date du contexte (jamais après). */
  abstract getNews(context: MarketContext): Promise<NewsItem[]>;
  /** Contexte médiatique sourcé pour la révélation des simulations ; null = rien de sourcé, ne rien afficher. */
  async historicalContext(_context: MarketContext): Promise<HistoricalContext | null> {
    return null;
  }
}

/**
 * Implémentation locale : AUCUNE vraie nouvelle. Elle transforme les mouvements de prix
 * en « signaux » clairement étiquetés comme simulés, pour que le pipeline soit testable.
 */
@Injectable()
export class MockNewsProvider extends NewsProvider {
  async getNews(c: MarketContext): Promise<NewsItem[]> {
    const source = 'Signal dérivé des prix (simulé)';
    const news: NewsItem[] = [];
    if (Math.abs(c.ret1d) >= 0.04) {
      news.push({ date: c.date, source, simulated: true, impact: 'élevé',
        title: `${c.ticker} : mouvement de ${pct(c.ret1d)} en une séance — forte attention probable` });
    }
    if (c.ret30d >= 0.2) {
      news.push({ date: c.date, source, simulated: true, impact: 'élevé',
        title: `${c.ticker} : ${pct(c.ret30d)} en 30 séances — titre probablement très médiatisé` });
    }
    if (c.drawdown90d <= -0.15) {
      news.push({ date: c.date, source, simulated: true, impact: 'moyen',
        title: `${c.ticker} : ${pct(c.drawdown90d)} sous son sommet de 90 séances — climat négatif probable` });
    }
    return news;
  }
}
