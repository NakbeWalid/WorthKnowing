import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import { BankTrade } from './types';

export interface BankEvent {
  accountId: string;
  tradeId: string;
  at: string;
  trade: BankTrade;
}

/**
 * Bus d'événements en mémoire (même principe que celui de Miroir) : notifie le navigateur du
 * client quand l'enquête Miroir, lancée en arrière-plan après l'exécution immédiate de l'ordre,
 * se termine (succès ou échec) — sans que le client ait eu à attendre dessus.
 */
@Injectable()
export class EventsService {
  readonly stream$ = new Subject<BankEvent>();

  emit(trade: BankTrade) {
    this.stream$.next({ accountId: trade.accountId, tradeId: trade.id, at: new Date().toISOString(), trade });
  }
}
