// Constitue le corpus de nouvelles (data/news/) pour les dates de la démo :
// recherche GDELT (une requête / 5 s) + classement Bedrock, mis en cache.
// Usage : npm run build && NEWS_DRIVER=bedrock node scripts/prefetch_news.mjs [TICKER:DATE ...]
import { createRequire } from 'module';

process.env.NEWS_DRIVER = 'bedrock';
process.env.NEWS_TIMEOUT_MS ??= '900000'; // pas de limite courte hors ligne
process.env.GDELT_PATIENCE_MS ??= '600000'; // hors ligne, on peut attendre GDELT jusqu'à 10 min par requête
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/miroir/app.module.js');
const { MarketService } = require('../dist/shared/market.service.js');
const { NewsProvider } = require('../dist/miroir/news/news.provider.js');

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
const market = app.get(MarketService);
const news = app.get(NewsProvider);

// Trades du scénario de démonstration (KIRO_HANDOFF.md §7 et scripts/e2e.mjs). La révélation n'utilise plus de nouvelles.
// Dans l'ordre chronologique : l'horloge de marché de la plateforme de courtage ne recule pas.
const demo = ['XBB.TO:2023-01-10', 'NVDA:2023-05-30', 'BTC-USD:2024-03-25', 'TSLA:2024-12-17', 'ETH-USD:2025-08-22'];
const targets = process.argv.length > 2 ? process.argv.slice(2) : demo;

for (const [i, target] of targets.entries()) {
  const [ticker, date] = target.split(':');
  const context = market.context(ticker, date);
  const items = await news.getNews(context);
  console.log(`${i + 1}/${targets.length} ${ticker} ${context.date} : ${items.length} nouvelle(s)`
    + `${items.some((n) => n.simulated) ? ' (REPLI SIMULÉ)' : ''}`);
}
await app.close();
