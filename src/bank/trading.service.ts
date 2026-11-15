import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MarketService } from '../shared/market.service';
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
  constructor(
    private store: BankStore,
    private market: MarketService,
    private miroir: MiroirClient,
    private links: MiroirLinkService,
  ) {}

  /** Portefeuille valorisé à une date de marché (par défaut : celle du dernier trade). */
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
    const trade: BankTrade = {
      id: randomUUID(), accountId: account.id, ticker: input.ticker, side: input.side, amount,
      price: quote.price, qty, currency: quote.currency, marketDate: quote.date, createdAt: new Date().toISOString(),
      decisionTimeMs: Math.max(0, Number(input.decisionTimeMs) || 0), note: String(input.note ?? '').slice(0, 280),
      miroir: { status: 'not_linked' },
    };
    await this.store.saveAccount(account);

    // [3] Envoi à Miroir pour enquête. L'ordre est déjà exécuté : un échec ici ne l'annule pas.
    let verdict: MiroirVerdict | null = null;
    if (account.miroir.status === 'linked') {
      try {
        verdict = await this.miroir.submit(account.miroir.personaCode!, { ...payload, externalId: trade.id });
        trade.miroir = {
          status: 'analysed', tradeId: verdict.tradeId, driftBefore: verdict.drift.before, driftAfter: verdict.drift.score,
          overrodeRules: verdict.overrodeRules, summary: verdict.investigation.explanation.summary,
        } satisfies TradeMiroirResult;
      } catch (err) {
        trade.miroir = { status: 'unavailable' };
        await this.links.handleRevoked(account, err);
      }
    }
    await this.store.saveTrade(trade);
    return { trade, portfolio: this.portfolio(account), miroir: verdict };
  }

  history(account: Account) { return this.store.listTrades(account.id); }

  /** Cotation d'un actif à une date de marché. */
  quote(ticker: string, date?: string) {
    const c = this.market.context(String(ticker), date || this.market.lastDate);
    return { ticker: c.ticker, name: c.name, price: c.price, currency: c.currency, date: c.date, ret1d: c.ret1d, ret30d: c.ret30d, vol30d: c.vol30d };
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
    const quote = this.quote(input.ticker, input.marketDate);
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
