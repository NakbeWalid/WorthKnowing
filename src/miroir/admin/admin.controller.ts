import { Controller, Get, MessageEvent, NotFoundException, Param, Sse, UseGuards } from '@nestjs/common';
import { interval, map, merge, Observable } from 'rxjs';
import { AdminGuard } from '../auth/auth.guard';
import { publicUser } from '../auth/auth.service';
import { EventsService } from '../realtime/events.service';
import { Store } from '../storage/store';
import { TradesService } from '../trades/trades.service';

/** Vue admin : tous les utilisateurs, leurs profils, règles, trades — et le flux temps réel. */
@Controller('api/admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private store: Store, private trades: TradesService, private events: EventsService) {}

  @Get('users')
  async users() {
    const users = (await this.store.listUsers()).filter((u) => u.role === 'user');
    return Promise.all(users.map(async (u) => ({
      id: u.id, name: u.name, email: u.email, status: u.status, createdAt: u.createdAt,
      drift: u.drift.score, rules: u.rules.length, linked: u.link?.status === 'active', trades: (await this.store.listTrades(u.id)).length,
    })));
  }

  @Get('users/:id')
  async user(@Param('id') id: string) {
    const user = await this.store.getUser(id);
    if (!user) throw new NotFoundException('Utilisateur introuvable.');
    return { user: publicUser(user), trades: await this.store.listTrades(id) };
  }

  /**
   * Flux Server-Sent Events : un message par étape du pipeline (trade → enquête → profil).
   * Un événement nommé « ping » toutes les 20 s garde la connexion ouverte derrière CloudFront et
   * l'équilibreur de charge ; le navigateur l'ignore (onmessage ne reçoit que les messages sans nom).
   */
  @Sse('stream')
  stream(): Observable<MessageEvent> {
    return merge(
      this.events.stream$.pipe(map((event) => ({ data: event }))),
      interval(20_000).pipe(map(() => ({ type: 'ping', data: '' }))),
    );
  }
}
