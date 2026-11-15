import { Injectable, Logger } from '@nestjs/common';
import { config } from './config';

/** Erreur d'un appel à Miroir : `status` = code HTTP, ou 0 si Miroir est injoignable ou trop lent. */
export class MiroirError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Trade tel qu'envoyé à Miroir : l'ordre + le portefeuille du client AVANT l'ordre. */
export interface MiroirTradePayload {
  ticker: string;
  side: 'buy' | 'sell';
  amount: number;
  marketDate: string;
  decisionTimeMs?: number;
  note?: string;
  externalId?: string;
  portfolio: { cash: number; positions: { ticker: string; value: number }[] };
}

export interface MiroirRule { ruleId: string; param: string; text: string; reason: string }
export interface MiroirCheck {
  triggeredRules: MiroirRule[];
  warnings: string[];
  reevaluationRequired: boolean;
  drift: { score: number; threshold: number };
}
export interface MiroirPersona {
  status: 'onboarding' | 'active' | 'reevaluation_required';
  drift: { score: number; threshold: number };
  evaluatedAt: string | null;
  rules: { id: string; param: string; text: string }[];
}
export interface MiroirVerdict {
  tradeId: string;
  reevaluationRequired: boolean;
  drift: { score: number; before: number; threshold: number };
  overrodeRules: boolean;
  /** Enquête complète, affichée telle quelle au client (la plateforme ne la conserve pas). */
  investigation: { explanation: { summary: string } } & Record<string, unknown>;
}

/**
 * Seul point de contact avec Miroir : son API partenaire v1, de serveur à serveur.
 *   x-partner-key   authentifie la plateforme ;
 *   x-persona-code  dit à quel profil Miroir appartient le trade (reçu lors de la liaison du compte).
 */
@Injectable()
export class MiroirClient {
  private log = new Logger('Miroir');

  /** Échange le code à usage unique rapporté par le navigateur contre le code persona. */
  exchange(code: string) {
    return this.call<{ personaCode: string; persona: MiroirPersona }>('POST', '/link/exchange', { body: { code } });
  }
  persona(personaCode: string) { return this.call<MiroirPersona>('GET', '/persona', { personaCode }); }
  revoke(personaCode: string) { return this.call<{ ok: boolean }>('DELETE', '/link', { personaCode }); }

  /** AVANT l'ordre : y a-t-il une règle à rappeler au client ? */
  check(personaCode: string, trade: MiroirTradePayload) {
    return this.call<MiroirCheck>('POST', '/trades/check', { personaCode, body: trade, timeoutMs: config.miroir.checkTimeoutMs });
  }
  /** Le client a renoncé après le rappel. */
  abandon(personaCode: string, trade: MiroirTradePayload) {
    return this.call<{ respected: number; drift: number }>('POST', '/trades/abandon', { personaCode, body: trade });
  }
  /** APRÈS l'ordre exécuté : enquête et mise à jour du profil. */
  submit(personaCode: string, trade: MiroirTradePayload) {
    return this.call<MiroirVerdict>('POST', '/trades', { personaCode, body: trade, timeoutMs: config.miroir.submitTimeoutMs });
  }

  private async call<T>(method: string, path: string, opts: { personaCode?: string; body?: unknown; timeoutMs?: number }): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-partner-key': config.miroir.apiKey };
    if (opts.personaCode) headers['x-persona-code'] = opts.personaCode;
    let res: Response;
    try {
      res = await fetch(`${config.miroir.apiUrl}/api/partner/v1${path}`, {
        method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
    } catch (err) {
      this.log.warn(`${method} ${path} : Miroir injoignable (${(err as Error).message})`);
      throw new MiroirError(0, 'Miroir est injoignable pour le moment.');
    }
    const text = await res.text().catch(() => '');
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch { /* réponse non JSON (proxy) */ }
    if (!res.ok) {
      const message = Array.isArray(data.message) ? data.message.join(' ') : data.message;
      throw new MiroirError(res.status, message || `Miroir a répondu ${res.status}.`);
    }
    return data as T;
  }
}
