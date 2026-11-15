// Constitue le corpus de nouvelles (data/news/) pour les dates de la démo et les 60 simulations :
// recherche GDELT (une requête / 5 s) + classement et résumé Bedrock, mis en cache.
// Usage : npm run build && NEWS_DRIVER=bedrock node scripts/prefetch_news.mjs [TICKER:DATE ...]
import { readFileSync } from 'fs';
import { createRequire } from 'module';

process.env.NEWS_DRIVER = 'bedrock';
process.env.GDELT_PATIENCE_MS ??= '600000'; // hors ligne, on peut attendre GDELT jusqu'à 10 min par requête
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module.js');
const { MarketService } = require('../dist/market/market.service.js');
const { NewsProvider } = require('../dist/news/news.provider.js');

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
const market = app.get(MarketService);
const news = app.get(NewsProvider);

// Trades du scénario de démonstration (KIRO_HANDOFF.md §7 et scripts/e2e.mjs), puis les révélations.
const demo = ['NVDA:2023-05-30', 'TSLA:2024-12-17', 'BTC-USD:2024-03-25', 'ETH-USD:2025-08-22', `XBB.TO:${market.lastDate}`];
const scenarios = JSON.parse(readFileSync('data/scenarios.json', 'utf-8')).map((s) => `${s.reveal.ticker}:${s.reveal.decisionDate}`);
const targets = process.argv.length > 2 ? process.argv.slice(2) : [...new Set([...demo, ...scenarios])];

for (const [i, target] of targets.entries()) {
  const [ticker, date] = target.split(':');
  const context = market.context(ticker, date);
  const items = await news.getNews(context);
  const hc = await news.historicalContext(context);
  console.log(`${i + 1}/${targets.length} ${ticker} ${context.date} : ${items.length} nouvelle(s)`
    + `${items.some((n) => n.simulated) ? ' (REPLI SIMULÉ)' : ''}${hc ? ' + contexte' : ''}`);
}
await app.close();
