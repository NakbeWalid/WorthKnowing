import { ConflictException, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'crypto';
import { config } from '../config';
import { User } from '../domain/types';
import { EventsService } from '../realtime/events.service';
import { Store } from '../storage/store';

export interface TokenPayload { sub: string; role: 'user' | 'admin'; exp: number }

/**
 * Authentification locale (mot de passe haché + jeton signé HMAC).
 *
 * ▶ POINT D'INTÉGRATION AWS (Kiro) : remplacer par Amazon Cognito (User Pool avec
 *   un groupe « admin »). `verify()` devient la vérification du JWT Cognito ;
 *   AuthGuard et les contrôleurs ne changent pas.
 */
@Injectable()
export class AuthService implements OnModuleInit {
  constructor(private store: Store, private events: EventsService) {}

  /** Crée le compte admin au premier démarrage. */
  async onModuleInit() {
    if (!(await this.store.getUserByEmail(config.adminEmail))) {
      await this.store.saveUser(this.newUser(config.adminEmail, config.adminPassword, 'Admin', 'admin'));
    }
  }

  async register(email: string, password: string, name: string) {
    if (!email?.includes('@') || !password || password.length < 6 || !name?.trim()) {
      throw new UnauthorizedException('Courriel, nom et mot de passe (6 caractères min.) requis.');
    }
    if (await this.store.getUserByEmail(email)) throw new ConflictException('Ce courriel est déjà inscrit.');
    const user = this.newUser(email, password, name.trim(), 'user');
    await this.store.saveUser(user);
    this.events.emit('user.registered', user, 'Nouvel utilisateur inscrit');
    return { token: this.sign(user), user: publicUser(user) };
  }

  async login(email: string, password: string) {
    const user = await this.store.getUserByEmail(email ?? '');
    if (!user || !this.checkPassword(password ?? '', user.passwordHash)) {
      throw new UnauthorizedException('Courriel ou mot de passe invalide.');
    }
    return { token: this.sign(user), user: publicUser(user) };
  }

  verify(token: string): TokenPayload {
    const [body, signature] = (token ?? '').split('.');
    if (!body || !signature || signature !== this.hmac(body)) throw new UnauthorizedException('Jeton invalide.');
    const payload: TokenPayload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp < Date.now()) throw new UnauthorizedException('Session expirée.');
    return payload;
  }

  private sign(user: User) {
    const payload: TokenPayload = { sub: user.id, role: user.role, exp: Date.now() + 24 * 3600 * 1000 };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${this.hmac(body)}`;
  }

  private hmac(data: string) {
    return createHmac('sha256', config.jwtSecret).update(data).digest('base64url');
  }

  private hashPassword(password: string) {
    const salt = randomBytes(16).toString('hex');
    return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
  }

  private checkPassword(password: string, stored: string) {
    const [salt, hash] = stored.split(':');
    return timingSafeEqual(Buffer.from(hash, 'hex'), scryptSync(password, salt, 32));
  }

  private newUser(email: string, password: string, name: string, role: 'user' | 'admin'): User {
    return {
      id: randomUUID(), email: email.toLowerCase(), name, role,
      passwordHash: this.hashPassword(password), createdAt: new Date().toISOString(),
      status: 'onboarding', preferences: {}, profile: null, rules: [],
      drift: { score: 0, overrides: 0 },
      portfolio: { cash: config.startingCash, positions: {} },
      seenScenarios: [],
    };
  }
}

/** Ce que le navigateur a le droit de voir (jamais le hash du mot de passe). */
export function publicUser(user: User) {
  const { passwordHash, seenScenarios, ...rest } = user;
  return { ...rest, driftThreshold: config.driftThreshold };
}
