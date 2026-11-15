import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

export interface AppEvent {
  type: 'user.registered' | 'evaluation.completed' | 'link.created' | 'link.revoked' | 'rule.respected'
    | 'trade.received' | 'investigation.completed' | 'profile.updated';
  userId: string;
  userName: string;
  at: string;
  message: string;
  payload?: unknown;
}

/**
 * Bus d'événements en mémoire : chaque étape du pipeline publie ici,
 * la vue admin s'y abonne en temps réel (SSE).
 *
 * ▶ POINT D'INTÉGRATION AWS (Kiro) : publier sur EventBridge (ou SNS) et diffuser
 *   aux navigateurs via AppSync Events / API Gateway WebSocket.
 */
@Injectable()
export class EventsService {
  readonly stream$ = new Subject<AppEvent>();

  emit(type: AppEvent['type'], user: { id: string; name: string }, message: string, payload?: unknown) {
    this.stream$.next({ type, userId: user.id, userName: user.name, at: new Date().toISOString(), message, payload });
  }
}
