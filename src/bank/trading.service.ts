import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MarketService } from '../shared/market.service';
import { config } from './config';
import { EventsService } from './events.service';
import { MiroirLinkService } from './miroir-link.service';
import { MiroirCheck, MiroirClient, MiroirError, MiroirTradePayload, MiroirVerdict } from './miroir.client';
import { BankStore } from './store';
import { Account, BankTrade, TradeInput, TradeMiroirResult } from './types';

/** Réponse Miroir au pré-contrôle, telle que renvoyée au navigateur. */
type Precheck =
  | { status: 'not_linked' }
  | { status: 'unavailable' }
  | ({ status: 'ok' } & MiroirCheck);

/**
 * Passage d'ordres (simulation : aucun ordre réel). Pour un compte lié à Miroir, chaque ordre suit ce parcours :
 *
 *   preview()  -> validation + PRÉ-CONTRÔLE Miroir : y a-t-il une règle personnelle à rappeler au client ?
 *   execute()  -> exécution dans le portefeuille + historique, PUIS envoi du trade à Miroir pour enquête
 *   cancel()   -> le client renonce après le rappel : Miroir en est informé (« règle respectée »)
 *
 * Miroir ne peut jamais empêcher la plateforme de fonctionner : s'il est injoignable, l'ordre passe sans lui.
 * Pour un compte non lié, rien ne sort de la plateforme : l'ordre est exécuté et conservé dans l'historique.
 */
@Injectable()
export class TradingService {
  private log = new Logger('Trading');
  /** Enquêtes en cours dans CE processus (une enquête « pending » absente d'ici a été perdue, ex. redémarrage). */
  private inFlight = new Set<string>();

  constructor(
    private store: BankStore,
    private market: MarketService,
    private miroir: MiroirClient,
    private links: MiroirLinkService,
    private events: EventsService,
  ) {}

  /** Portefeuille valorisé à une date de marché (par défaut : celle du dernier ordre). */
  portfolio(account: Account, date = account.asOf ?? this.market.lastDate) {
    const positions = Object.entries(account.positions).map(([ticker, p]) => {
      const value = p.qty * this.market.priceAt(ticker, date);
      return { ticker, qty: p.qty, invested: p.invested, value, gain: value - p.invested };
    }).sort((a, b) => b.value - a.value);
    const total = account.cash + positions.reduce((sum, p) => sum + p.value, 0);
    return { date, cash: account.cash, total, positions: positions.map((p) => ({ ...p, weight: p.value / total })) };
  }

  /** Avant confirmation : cotation, validation de l'ordre et rappel éventuel des règles Miroir. */
  async preview(account: Account, input: TradeInput) {
    const order = this.validate(account, input);
    return { quote: order.quote, miroir: await this.precheck(account, order.payload) };
  }

  /** Le client a renoncé à l'ordre après le rappel d'une règle. */
  async cancel(account: Account, input: TradeInput) {
    if (account.miroir.status !== 'linked') return { ok: true };
    const { payload } = this.validate(account, input);
    await this.miroir.abandon(account.miroir.personaCode!, payload).catch((err) => this.links.handleRevoked(account, err));
    return { ok: true };
  }

  async execute(account: Account, input: TradeInput) {
    const { quote, amount, payload } = this.validate(account, input);

    // [1] Pré-contrôle refait côté serveur : un rappel de règle ne peut pas être contourné par le navigateur.
    const check = await this.precheck(account, payload);
    if (check.status === 'ok') {
      if (check.reevaluationRequired) {
        throw new ConflictException({ message: 'Miroir demande une réévaluation de votre profil avant tout nouvel ordre.', reevaluationRequired: true });
      }
      const acknowledged = input.acknowledgedRuleIds ?? [];
      if (check.triggeredRules.some((r) => !acknowledged.includes(r.ruleId))) {
        throw new ConflictException({ message: 'Cet ordre touche une de vos règles Miroir : confirmation requise.', miroir: check });
      }
    }

    // [2] Exécution dans le portefeuille (fictif).
    const qty = amount / quote.price;
    const position = account.positions[input.ticker] ?? { qty: 0, invested: 0 };
    if (input.side === 'buy') {
      account.cash -= amount;
      account.positions[input.ticker] = { qty: position.qty + qty, invested: position.invested + amount };
    } else {
      const remaining = position.qty - qty;
      account.cash += amount;
      if (remaining * quote.price < 1) delete account.positions[input.ticker]; // reliquat de quelques cents
      else account.positions[input.ticker] = { qty: remaining, invested: position.invested * (remaining / position.qty) };
    }
    account.asOf = quote.date;
    const linked = account.miroir.status === 'linked';
    const trade: BankTrade = {
      id: randomUUID(), accountId: account.id, ticker: input.ticker, side: input.side, amount,
      price: quote.price, qty, currency: quote.currency, marketDate: quote.date, createdAt: new Date().toISOString(),
      decisionTimeMs: Math.max(0, Number(input.decisionTimeMs) || 0), note: String(input.note ?? '').slice(0, 280),
      // « pending » : l'ordre est déjà exécuté, l'enquête Miroir se poursuit en arrière-plan (voir [3]).
      miroir: { status: linked ? 'pending' : 'not_linked' },
    };
    await this.store.saveAccount(account);
    await this.store.saveTrade(trade);

    // [3] Envoi à Miroir pour enquête, SANS bloquer la réponse : l'ordre est déjà exécuté et confirmé
    // au client (ci-dessous) ; l'enquête (jusqu'à 50 s) se termine en arrière-plan et le résultat est
    // notifié par SSE (investigate() sauvegarde le trade mis à jour et émet l'événement correspondant).
    if (linked) {
      this.inFlight.add(trade.id);
      void this.investigate(account, trade, { ...payload, externalId: trade.id });
    }

    return { trade, portfolio: this.portfolio(account) };
  }

  /** Enquête Miroir en arrière-plan : met à jour et sauvegarde le trade, puis notifie le navigateur (SSE). */
  private async investigate(account: Account, trade: BankTrade, payload: MiroirTradePayload) {
    this.inFlight.add(trade.id);
    try {
      const verdict: MiroirVerdict = await this.miroir.submit(account.miroir.personaCode!, payload);
      trade.miroir = {
        status: 'analysed', tradeId: verdict.tradeId, driftBefore: verdict.drift.before, driftAfter: verdict.drift.score,
        overrodeRules: verdict.overrodeRules, summary: verdict.investigation.explanation.summary,
        reevaluationRequired: verdict.reevaluationRequired,
      } satisfies TradeMiroirResult;
    } catch (err) {
      this.log.warn(`Enquête Miroir impossible pour l'ordre ${trade.id} (${trade.side} ${trade.ticker}) : ${(err as Error).message}`);
      trade.miroir = { status: 'unavailable' };
      await this.links.handleRevoked(account, err).catch(() => {});
    } finally {
      this.inFlight.delete(trade.id);
    }
    await this.store.saveTrade(trade);
    this.events.emit(trade);
  }

  /**
   * Rattrapage : analyse les ordres que Miroir n'a pas (ou pas encore) vus — passés avant la liaison du compte,
   * pendant une panne, ou perdus en route (redémarrage pendant l'enquête). Rejoués dans l'ordre chronologique
   * pour que le score de dérive évolue comme il l'aurait fait. Miroir ignore un ordre déjà reçu (externalId),
   * donc relancer est sans danger. Rend le nombre d'ordres relancés ; l'enquête se poursuit en arrière-plan.
   */
  async backfill(account: Account): Promise<{ started: number }> {
    if (account.miroir.status !== 'linked') throw new ConflictException('WorthKnowing n’est pas activé sur ce compte.');
    const stale = Date.now() - 3 * 60_000;
    const todo = (await this.store.listTrades(account.id))
      .filter((t) => ['not_linked', 'unavailable'].includes(t.miroir.status)
        || (t.miroir.status === 'pending' && !this.inFlight.has(t.id) && new Date(t.createdAt).getTime() < stale))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (!todo.length) return { started: 0 };
    const all = (await this.store.listTrades(account.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const jobs = todo.map((trade) => {
      trade.miroir = { status: 'pending' };
      return { trade, payload: { ...this.payloadBefore(all, trade), externalId: trade.id } };
    });
    for (const { trade } of jobs) await this.store.saveTrade(trade);
    for (const { trade } of jobs) this.inFlight.add(trade.id);
    void (async () => { // séquentiel : chaque verdict met à jour le profil utilisé par le suivant
      for (const { trade, payload } of jobs) await this.investigate(account, trade, payload);
    })();
    return { started: jobs.length };
  }

  /** Reconstitue ce que Miroir aurait reçu : l'ordre et le portefeuille AVANT lui (rejeu des ordres précédents). */
  private payloadBefore(sorted: BankTrade[], trade: BankTrade): MiroirTradePayload {
    let cash = config.startingCash;
    const qty: Record<string, number> = {};
    for (const t of sorted) {
      if (t.id === trade.id) break;
      cash += t.side === 'buy' ? -t.amount : t.amount;
      qty[t.ticker] = (qty[t.ticker] ?? 0) + (t.side === 'buy' ? t.qty : -t.qty);
    }
    const positions = Object.entries(qty)
      .map(([ticker, q]) => ({ ticker, value: q > 1e-9 ? q * this.market.priceAt(ticker, trade.marketDate) : 0 }))
      .filter((p) => p.value > 0.005);
    return {
      ticker: trade.ticker, side: trade.side, amount: trade.amount, marketDate: trade.marketDate,
      decisionTimeMs: trade.decisionTimeMs, note: trade.note, portfolio: { cash, positions },
    };
  }

  history(account: Account) { return this.store.listTrades(account.id); }

  /** Cotation d'un actif à une date de marché. */
  quote(ticker: string, date?: string) {
    const c = this.market.context(String(ticker), date || this.market.lastDate);
    return {
      ticker: c.ticker, name: c.name, price: c.price, currency: c.currency, date: c.date, ret1d: c.ret1d, ret30d: c.ret30d, vol30d: c.vol30d,
      history: this.market.history(c.ticker, c.date, 90),
    };
  }

  /**
   * Valeur du compte dans le temps : on rejoue les ordres (dans l'ordre où ils ont été passés) et on
   * valorise le portefeuille à chaque séance, de la veille du premier ordre jusqu'à l'horloge du compte.
   * Échantillonné à ~120 points au plus.
   */
  async valueHistory(account: Account, startingCash: number) {
    const trades = [...(await this.store.listTrades(account.id))].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (!trades.length || !account.asOf) return { points: [] as { date: string; value: number }[] };
    const days = this.market.sessions(trades[0].marketDate, account.asOf);
    const step = Math.max(1, Math.ceil(days.length / 120));
    const sampled = days.filter((_, i) => i % step === 0 || i === days.length - 1);
    let cash = startingCash;
    const qty: Record<string, number> = {};
    let k = 0;
    const points = [{ date: trades[0].marketDate, value: startingCash, start: true }] as { date: string; value: number; start?: boolean }[];
    for (const date of sampled) {
      while (k < trades.length && trades[k].marketDate <= date) {
        const t = trades[k++];
        cash += t.side === 'buy' ? -t.amount : t.amount;
        qty[t.ticker] = (qty[t.ticker] ?? 0) + (t.side === 'buy' ? t.qty : -t.qty);
      }
      const value = cash + Object.entries(qty).reduce((sum, [ticker, q]) => sum + (q > 1e-9 ? q * this.market.priceAt(ticker, date) : 0), 0);
      points.push({ date, value });
    }
    return { points: points.map(({ date, value }) => ({ date, value: Math.round(value * 100) / 100 })) };
  }

  // ------------------------------------------------------------------ privé

  private async precheck(account: Account, payload: MiroirTradePayload): Promise<Precheck> {
    if (account.miroir.status !== 'linked') return { status: 'not_linked' };
    try {
      return { status: 'ok', ...(await this.miroir.check(account.miroir.personaCode!, payload)) };
    } catch (err) {
      await this.links.handleRevoked(account, err);
      // Miroir a explicitement refusé la requête (4xx hors 401) : c'est une erreur d'intégration, pas une panne.
      if (err instanceof MiroirError && err.status >= 400 && err.status < 500 && err.status !== 401) {
        throw new BadRequestException(`Miroir a refusé le contrôle : ${err.message}`);
      }
      return account.miroir.status === 'linked' ? { status: 'unavailable' } : { status: 'not_linked' };
    }
  }

  /** Valide l'ordre et prépare ce qui sera envoyé à Miroir (ordre + portefeuille AVANT l'ordre). */
  private validate(account: Account, input: TradeInput) {
    if (!input || !['buy', 'sell'].includes(input.side)) throw new BadRequestException('Sens de l’ordre invalide.');
    const amount = Math.round(Number(input.amount) * 100) / 100;
    if (!(amount > 0) || !Number.isFinite(amount)) throw new BadRequestException('Montant invalide.');
    const quote = this.quote(input.ticker, input.marketDate || account.asOf);
    // L'horloge de marché simulée n'avance que dans un sens : sinon le portefeuille serait valorisé à deux dates à la fois.
    if (account.asOf && quote.date < account.asOf) {
      throw new BadRequestException(`La date de marché simulée ne peut pas reculer : votre dernier ordre est daté du ${account.asOf}.`);
    }
    const pf = this.portfolio(account, quote.date);
    const held = pf.positions.find((p) => p.ticker === input.ticker)?.value ?? 0;
    if (input.side === 'buy' && amount > pf.cash + 0.005) {
      throw new BadRequestException(`Liquidités insuffisantes : ${Math.floor(pf.cash).toLocaleString('fr-CA')} $ disponibles.`);
    }
    if (input.side === 'sell' && amount > held + 0.005) {
      throw new BadRequestException(held > 0
        ? `Vous ne détenez que ${Math.floor(held).toLocaleString('fr-CA')} $ de ${input.ticker}.`
        : `Vous ne détenez pas ${input.ticker}.`);
    }
    const payload: MiroirTradePayload = {
      ticker: input.ticker, side: input.side, amount, marketDate: quote.date,
      decisionTimeMs: Math.max(0, Number(input.decisionTimeMs) || 0), note: String(input.note ?? '').slice(0, 280),
      portfolio: { cash: pf.cash, positions: pf.positions.map((p) => ({ ticker: p.ticker, value: p.value })) },
    };
    return { quote, amount, payload };
  }
}
