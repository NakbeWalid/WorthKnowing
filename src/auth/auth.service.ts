import { BadRequestException, ConflictException, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'crypto';
import { config } from '../config';
import { User } from '../domain/types';
import { EventsService } from '../realtime/events.service';
import { Store } from '../storage/store';

export interface TokenPayload { sub: string; role: 'user' | 'admin'; exp: number }
export interface AuthResult { token: string; user: ReturnType<typeof publicUser> }

/**
 * Contrat d'authentification. Le navigateur envoie toujours `Authorization: Bearer <jeton>`.
 *   - LocalAuthService   : mot de passe scrypt + jeton HMAC (AUTH_DRIVER=local, démo sans AWS) ;
 *   - CognitoAuthService : Amazon Cognito (AUTH_DRIVER=cognito), voir cognito-auth.service.ts.
 */
export abstract class AuthService {
  abstract register(email: string, password: string, name: string): Promise<AuthResult>;
  abstract login(email: string, password: string): Promise<AuthResult>;
  /** Vérifie le jeton ; le rôle vient du jeton (groupe Cognito « admin » en mode cognito). */
  abstract verify(token: string): Promise<TokenPayload>;
}

/** Règles communes d'inscription (Cognito applique en plus sa propre politique de mot de passe). */
export function validateRegistration(email: string, password: string, name: string) {
  if (!email?.includes('@') || !name?.trim() || !password || password.length < 8 || !/\d/.test(password) || !/[a-z]/.test(password)) {
    throw new BadRequestException('Courriel, prénom et mot de passe (8 caractères min., avec au moins une minuscule et un chiffre) requis.');
  }
}

/** Nouvel utilisateur métier (stocké dans le Store, quel que soit le fournisseur d'identité). */
export function newUser(id: string, email: string, name: string, role: 'user' | 'admin', passwordHash = ''): User {
  return {
    id, email: email.toLowerCase(), name, role,
    passwordHash, createdAt: new Date().toISOString(),
    status: 'onboarding', preferences: {}, profile: null, rules: [],
    drift: { score: 0, overrides: 0 },
    portfolio: { cash: config.startingCash, positions: {} },
    seenScenarios: [],
  };
}

/** Authentification locale (mot de passe haché + jeton signé HMAC). Suffisante pour la démo hors ligne. */
@Injectable()
export class LocalAuthService extends AuthService implements OnModuleInit {
  constructor(private store: Store, private events: EventsService) {
    super();
  }

  /** Crée le compte admin au premier démarrage. */
  async onModuleInit() {
    if (!(await this.store.getUserByEmail(config.adminEmail))) {
      await this.store.saveUser(newUser(randomUUID(), config.adminEmail, 'Admin', 'admin', this.hashPassword(config.adminPassword)));
    }
  }

  async register(email: string, password: string, name: string) {
    validateRegistration(email, password, name);
    if (await this.store.getUserByEmail(email)) throw new ConflictException('Ce courriel est déjà inscrit.');
    const user = newUser(randomUUID(), email, name.trim(), 'user', this.hashPassword(password));
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

  async verify(token: string): Promise<TokenPayload> {
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
    if (!salt || !hash) return false;
    return timingSafeEqual(Buffer.from(hash, 'hex'), scryptSync(password, salt, 32));
  }
}

/** Ce que le navigateur a le droit de voir (jamais le hash du mot de passe). */
export function publicUser(user: User) {
  const { passwordHash, seenScenarios, ...rest } = user;
  return { ...rest, driftThreshold: config.driftThreshold };
}
