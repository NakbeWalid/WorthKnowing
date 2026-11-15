import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MarketService } from '../../shared/market.service';
import { config } from '../config';
import { Investigation, PARAMS, Trade, User } from '../domain/types';
import { TradeMetrics } from '../evaluation/rule-templates';
import { NewsProvider } from '../news/news.provider';
import { EventsService } from '../realtime/events.service';
import { Store } from '../storage/store';
import { BehaviorAgent } from './agents/behavior.agent';
import { Explainer } from './agents/explainer';
import { GovernanceAgent } from './agents/governance.agent';
import { InfluenceAgent } from './agents/influence.agent';
import { CALM_DECAY, computeDrift, SIGNAL_WEIGHT } from './drift';

/** Portefeuille du client AVANT le trade, valorisé par la plateforme de courtage à la date de marché. */
export interface PortfolioSnapshot {
  cash: number;
  positions: { ticker: string; value: number }[];
}

/** Trade envoyé par la plateforme de courtage (API partenaire). Miroir ne détient aucun portefeuille. */
export interface TradeRequest {
  ticker: string;
  side: 'buy' | 'sell';
  amount: number;
  /** Date de marché simulée (défaut : dernière date des données). */
  marketDate?: string;
  /** Temps écoulé entre l'ouverture du formulaire et la confirmation. */
  decisionTimeMs?: number;
  note?: string;
  portfolio: PortfolioSnapshot;
  /** Identifiant du trade chez le partenaire : un renvoi du même trade ne compte qu'une fois. */
  externalId?: string;
}

/**
 * Pipeline Miroir d'un trade exécuté chez le partenaire :
 *
 *   AVANT le trade   POST /api/partner/v1/trades/check   -> règles personnelles à rappeler (aucun effet)
 *   APRÈS le trade   POST /api/partner/v1/trades         -> [1] enquête (nouvelles, constats, influence)
 *                                                           [2] mise à jour du profil + score de dérive
 *                                                           [3] explication -> vue admin (temps réel)
 *   Trade annulé     POST /api/partner/v1/trades/abandon -> « règle respectée »
 *
 * Le trade a déjà eu lieu quand Miroir le reçoit : toute règle concernée est comptée comme outrepassée.
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

  /** Pré-contrôle sans effet : quelles règles rappeler au client AVANT qu'il confirme ? */
  async check(user: User, req: TradeRequest) {
    const metrics = this.metrics(user, req);
    return {
      triggeredRules: this.governance.triggeredRules(user, metrics),
      warnings: this.governance.coherenceWarnings(user, metrics),
      reevaluationRequired: user.status === 'reevaluation_required',
      drift: { score: user.drift.score, threshold: config.driftThreshold },
    };
  }

  /** Le client a renoncé au trade après le rappel : ses paramètres concernés se rapprochent de la référence. */
  async abandon(user: User, req: TradeRequest) {
    const metrics = this.metrics(user, req);
    const respected = this.governance.triggeredRules(user, metrics);
    if (!respected.length) return { respected: 0, drift: user.drift.score };
    const profile = user.profile!;
    for (const rule of respected) {
      const p = rule.param;
      profile.current[p] = Math.round(profile.current[p] + (profile.baseline[p] - profile.current[p]) * CALM_DECAY);
    }
    user.drift.score = computeDrift(profile.baseline, profile.current, user.drift.overrides);
    await this.store.saveUser(user);
    this.events.emit('rule.respected', user,
      `Ordre ${req.ticker} annulé après rappel — ${respected.length} règle(s) respectée(s)`);
    return { respected: respected.length, drift: user.drift.score };
  }

  async submit(user: User, req: TradeRequest): Promise<{ trade: Trade; status: User['status']; drift: User['drift'] }> {
    const externalId = req.externalId ? String(req.externalId).slice(0, 100) : undefined;
    const history = await this.store.listTrades(user.id);
    const duplicate = externalId && history.find((t) => t.externalId === externalId);
    if (duplicate) return { trade: duplicate, status: user.status, drift: user.drift };

    const metrics = this.metrics(user, req);
    const { context } = metrics;
    const triggeredRules = this.governance.triggeredRules(user, metrics);
    const base = {
      id: randomUUID(), userId: user.id, externalId, ticker: req.ticker, side: req.side, amount: Number(req.amount),
      price: context.price, qty: Number(req.amount) / context.price, marketDate: context.date,
      createdAt: new Date().toISOString(), decisionTimeMs: Math.max(0, Number(req.decisionTimeMs) || 0),
      note: String(req.note ?? '').slice(0, 280), overrodeRules: triggeredRules.length > 0,
    };
    this.events.emit('trade.received', user,
      `${req.side === 'buy' ? 'Achat' : 'Vente'} ${req.ticker} — ${base.amount.toLocaleString('fr-CA')} $`);
    await pause();

    // [1] Enquête : nouvelles + constats déterministes (socle) + agent d'influence (IA, borné).
    // Filet de sécurité : une panne de la recherche de nouvelles ne doit jamais faire échouer l'enquête.
    const news = await this.news.getNews(context).catch(() => []);
    const deterministic = this.behavior.analyse(metrics, triggeredRules);
    const ai = await this.influence.analyse({
      metrics, amount: base.amount, note: base.note, news, profile: user.profile!, deterministic,
      recentTrades: history.slice(0, 10),
    });
    const findings = [...deterministic, ...ai.findings];
    const warnings = this.governance.coherenceWarnings(user, metrics);
    this.events.emit('investigation.completed', user,
      findings.length ? `Enquête : ${findings.length} paramètre(s) mis en jeu` : 'Enquête : trade conforme au profil');
    await pause();

    // [2] Mise à jour des paramètres concernés et du score de dérive.
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
      // Un trade conforme efface aussi, progressivement, les depassements de regles passes.
      // Math.floor (et non Math.round) garantit une convergence reelle vers 0, sans rester bloque a 1.
      user.drift.overrides = Math.floor(user.drift.overrides * (1 - CALM_DECAY));
    }
    user.drift.overrides += triggeredRules.length;
    user.drift.score = computeDrift(profile.baseline, profile.current, user.drift.overrides);
    if (user.drift.score >= config.driftThreshold) user.status = 'reevaluation_required';

    // [3] Explication (sources, hypothèses, limites).
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

  /** Valide la requête du partenaire et calcule les mesures du trade (poids après exécution, délai de décision…). */
  private metrics(user: User, req: TradeRequest): TradeMetrics {
    if (!user.profile) throw new ConflictException('Ce persona n’a pas encore terminé son évaluation.');
    if (!req || !['buy', 'sell'].includes(req.side)) throw new BadRequestException('Sens du trade invalide (buy | sell).');
    const amount = Number(req.amount);
    if (!(amount > 0) || !Number.isFinite(amount)) throw new BadRequestException('Montant invalide.');
    const pf = req.portfolio;
    if (!pf || !(Number(pf.cash) >= 0) || !Array.isArray(pf.positions) || pf.positions.length > 500
      || pf.positions.some((p) => typeof p?.ticker !== 'string' || !(Number(p.value) >= 0))) {
      throw new BadRequestException('Portefeuille invalide : { cash, positions: [{ ticker, value }] } attendu.');
    }
    const context = this.market.context(String(req.ticker), req.marketDate || this.market.lastDate);
    const total = Number(pf.cash) + pf.positions.reduce((sum, p) => sum + Number(p.value), 0);
    if (!(total > 0)) throw new BadRequestException('Portefeuille vide.');
    const held = pf.positions.filter((p) => p.ticker === req.ticker).reduce((sum, p) => sum + Number(p.value), 0);
    const positionAfter = Math.max(0, held + (req.side === 'buy' ? amount : -amount));
    const speculativeHeld = pf.positions
      .filter((p) => p.ticker !== req.ticker && this.isSpeculative(p.ticker, context.date))
      .reduce((sum, p) => sum + Number(p.value), 0);
    return {
      side: req.side, context,
      positionWeight: Math.min(1, positionAfter / total),
      speculativeWeight: Math.min(1, (speculativeHeld + (context.speculative ? positionAfter : 0)) / total),
      decisionSeconds: Math.max(0, Number(req.decisionTimeMs) || 0) / 1000,
    };
  }

  /** Un actif que Miroir ne connaît pas (ou sans assez d'historique) est compté comme non spéculatif. */
  private isSpeculative(ticker: string, date: string) {
    try { return this.market.context(ticker, date).speculative; } catch { return false; }
  }
}

const pause = () => new Promise((resolve) => setTimeout(resolve, config.pipelineStepDelayMs));
