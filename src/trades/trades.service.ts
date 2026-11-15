import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { config } from '../config';
import { Investigation, PARAMS, Trade, User } from '../domain/types';
import { TradeMetrics } from '../evaluation/rule-templates';
import { MarketService } from '../market/market.service';
import { NewsProvider } from '../news/news.provider';
import { EventsService } from '../realtime/events.service';
import { Store } from '../storage/store';
import { BehaviorAgent } from './agents/behavior.agent';
import { Explainer } from './agents/explainer';
import { GovernanceAgent } from './agents/governance.agent';
import { InfluenceAgent } from './agents/influence.agent';
import { CALM_DECAY, computeDrift, SIGNAL_WEIGHT } from './drift';

export interface TradeRequest {
  ticker: string;
  side: 'buy' | 'sell';
  amount: number;
  /** Date de marché simulée (défaut : dernière date des données). */
  marketDate?: string;
  /** Temps écoulé entre l'ouverture du formulaire et la confirmation. */
  decisionTimeMs: number;
  note?: string;
  /** Règles rappelées que l'utilisateur a choisi d'outrepasser. */
  acknowledgedRuleIds?: string[];
}

/**
 * Pipeline d'un trade simulé :
 *
 *   requête -> [1] contrôle (gouvernance) -> [2] exécution fictive -> [3] enquête
 *           -> [4] mise à jour du profil + score de dérive -> [5] explication -> vue admin (temps réel)
 *
 * ▶ POINT D'INTÉGRATION AWS (Kiro) : aujourd'hui tout s'exécute dans ce service.
 *   Cible : API Gateway -> SQS -> Step Functions (une Lambda par étape), ou garder
 *   ce service sur ECS/App Runner et ne brancher que Bedrock, DynamoDB et EventBridge.
 */
@Injectable()
export class TradesService {
  constructor(
    private store: Store,
    private market: MarketService,
    private news: NewsProvider,
    private governance: GovernanceAgent,
    private behavior: BehaviorAgent,
    private explainer: Explainer,
    private influence: InfluenceAgent,
    private events: EventsService,
  ) {}

  /** Pré-contrôle sans effet : sert à rappeler à l'utilisateur ses règles AVANT qu'il confirme. */
  async check(user: User, req: TradeRequest) {
    const metrics = this.metrics(user, req);
    return {
      context: metrics.context,
      triggeredRules: this.governance.triggeredRules(user, metrics),
      warnings: this.governance.coherenceWarnings(user, metrics),
    };
  }

  async submit(user: User, req: TradeRequest): Promise<{ trade: Trade; status: User['status']; drift: User['drift'] }> {
    // [1] Contrôle : une règle concernée doit avoir été explicitement outrepassée.
    const metrics = this.metrics(user, req);
    const { context } = metrics;
    const triggeredRules = this.governance.triggeredRules(user, metrics);
    const acknowledged = req.acknowledgedRuleIds ?? [];
    if (triggeredRules.some((r) => !acknowledged.includes(r.ruleId))) {
      throw new ConflictException({ message: 'Ce trade touche une de vos règles : confirmation requise.', triggeredRules });
    }

    // [2] Exécution fictive dans le portefeuille simulé.
    const qty = req.amount / context.price;
    const position = user.portfolio.positions[req.ticker] ?? { qty: 0, invested: 0 };
    if (req.side === 'buy') {
      user.portfolio.cash -= req.amount;
      user.portfolio.positions[req.ticker] = { qty: position.qty + qty, invested: position.invested + req.amount };
    } else {
      const remaining = position.qty - qty;
      user.portfolio.cash += req.amount;
      if (remaining * context.price < 1) delete user.portfolio.positions[req.ticker];
      else user.portfolio.positions[req.ticker] = { qty: remaining, invested: position.invested * (remaining / position.qty) };
    }
    user.portfolio.asOf = context.date;
    const base = {
      id: randomUUID(), userId: user.id, ticker: req.ticker, side: req.side, amount: req.amount,
      price: context.price, qty, marketDate: context.date, createdAt: new Date().toISOString(),
      decisionTimeMs: Number(req.decisionTimeMs) || 0, note: (req.note ?? '').slice(0, 280),
      overrodeRules: triggeredRules.length > 0,
    };
    this.events.emit('trade.received', user,
      `${req.side === 'buy' ? 'Achat' : 'Vente'} ${req.ticker} — ${req.amount.toLocaleString('fr-CA')} $`);
    await pause();

    // [3] Enquête : nouvelles + constats déterministes (socle) + agent d'influence (IA, borné).
    const news = await this.news.getNews(context);
    const deterministic = this.behavior.analyse(metrics, triggeredRules);
    const ai = await this.influence.analyse({
      metrics, amount: req.amount, note: base.note, news, profile: user.profile!, deterministic,
      recentTrades: (await this.store.listTrades(user.id)).slice(0, 10),
    });
    const findings = [...deterministic, ...ai.findings];
    const warnings = this.governance.coherenceWarnings(user, metrics);
    this.events.emit('investigation.completed', user,
      findings.length ? `Enquête : ${findings.length} paramètre(s) mis en jeu` : 'Enquête : trade conforme au profil');
    await pause();

    // [4] Mise à jour des paramètres concernés et du score de dérive.
    const profile = user.profile!;
    const driftBefore = user.drift.score;
    const before = { ...profile.current };
    if (findings.length) {
      for (const f of findings) {
        profile.current[f.param] = Math.round(profile.current[f.param] * (1 - SIGNAL_WEIGHT) + f.signal * SIGNAL_WEIGHT);
      }
    } else {
      for (const p of PARAMS) {
        profile.current[p] = Math.round(profile.current[p] + (profile.baseline[p] - profile.current[p]) * CALM_DECAY);
      }
    }
    user.drift.overrides += triggeredRules.length;
    user.drift.score = computeDrift(profile.baseline, profile.current, user.drift.overrides);
    if (user.drift.score >= config.driftThreshold) user.status = 'reevaluation_required';

    // [5] Explication (sources, hypothèses, limites).
    const draft: Omit<Investigation, 'explanation'> = {
      context, news, findings, influence: ai.verdict, warnings, triggeredRules,
      paramUpdates: PARAMS.filter((p) => before[p] !== profile.current[p])
        .map((p) => ({ param: p, before: before[p], after: profile.current[p] })),
      driftBefore, driftAfter: user.drift.score,
    };
    const trade: Trade = { ...base, investigation: { ...draft, explanation: await this.explainer.explain(base, draft) } };

    await this.store.saveTrade(trade);
    await this.store.saveUser(user);
    this.events.emit('profile.updated', user,
      `Dérive ${driftBefore} → ${user.drift.score}${user.status === 'reevaluation_required' ? ' — réévaluation requise' : ''}`);
    return { trade, status: user.status, drift: user.drift };
  }

  history(user: User) { return this.store.listTrades(user.id); }

  /** Valeur du portefeuille à une date de marché donnée. */
  portfolio(user: User, date = user.portfolio.asOf ?? this.market.lastDate) {
    const positions = Object.entries(user.portfolio.positions).map(([ticker, p]) => ({
      ticker, qty: p.qty, invested: p.invested, value: p.qty * this.market.priceAt(ticker, date),
    }));
    const total = user.portfolio.cash + positions.reduce((sum, p) => sum + p.value, 0);
    return { date, cash: user.portfolio.cash, total, positions: positions.map((p) => ({ ...p, weight: p.value / total })) };
  }

  /** Valide la requête et calcule les mesures du trade (poids après exécution, délai de décision…). */
  private metrics(user: User, req: TradeRequest): TradeMetrics {
    if (user.status !== 'active' || !user.profile) {
      throw new ForbiddenException('Une évaluation de profil est requise avant de trader.');
    }
    if (!['buy', 'sell'].includes(req.side)) throw new BadRequestException('Sens du trade invalide.');
    const amount = Number(req.amount);
    if (!(amount > 0)) throw new BadRequestException('Montant invalide.');
    const date = req.marketDate || this.market.lastDate;
    const context = this.market.context(req.ticker, date);
    const pf = this.portfolio(user, context.date);
    const held = pf.positions.find((p) => p.ticker === req.ticker)?.value ?? 0;
    if (req.side === 'buy' && amount > pf.cash + 0.01) throw new BadRequestException('Liquidités insuffisantes.');
    if (req.side === 'sell' && amount > held + 0.01) {
      throw new BadRequestException(`Vous ne détenez que ${held.toFixed(0)} $ de ${req.ticker}.`);
    }
    const sign = req.side === 'buy' ? 1 : -1;
    const speculativeHeld = pf.positions
      .filter((p) => p.ticker !== req.ticker && this.market.context(p.ticker, context.date).speculative)
      .reduce((sum, p) => sum + p.value, 0);
    const positionAfter = held + sign * amount;
    return {
      side: req.side, context,
      positionWeight: positionAfter / pf.total,
      speculativeWeight: (speculativeHeld + (context.speculative ? positionAfter : 0)) / pf.total,
      decisionSeconds: (Number(req.decisionTimeMs) || 0) / 1000,
    };
  }
}

const pause = () => new Promise((resolve) => setTimeout(resolve, config.pipelineStepDelayMs));
