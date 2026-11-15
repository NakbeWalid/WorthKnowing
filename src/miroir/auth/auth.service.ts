import { BadRequestException, ConflictException, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { checkPassword, hashPassword, signToken, verifyToken } from '../../shared/local-auth';
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
    id, email: email.trim().toLowerCase(), name, role,
    passwordHash, createdAt: new Date().toISOString(),
    status: 'onboarding', preferences: {}, profile: null, rules: [],
    drift: { score: 0, overrides: 0 },
    link: null,
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
      await this.store.saveUser(newUser(randomUUID(), config.adminEmail, 'Admin', 'admin', hashPassword(config.adminPassword)));
    }
  }

  async register(email: string, password: string, name: string) {
    validateRegistration(email, password, name);
    if (await this.store.getUserByEmail(email)) throw new ConflictException('Ce courriel est déjà inscrit.');
    const user = newUser(randomUUID(), email, name.trim(), 'user', hashPassword(password));
    await this.store.saveUser(user);
    this.events.emit('user.registered', user, 'Nouvel utilisateur inscrit');
    return { token: this.sign(user), user: publicUser(user) };
  }

  async login(email: string, password: string) {
    const user = await this.store.getUserByEmail(email ?? '');
    if (!user || !checkPassword(password ?? '', user.passwordHash)) {
      throw new UnauthorizedException('Courriel ou mot de passe invalide.');
    }
    return { token: this.sign(user), user: publicUser(user) };
  }

  async verify(token: string): Promise<TokenPayload> {
    const payload = verifyToken<TokenPayload>(token, config.jwtSecret);
    if (!payload) throw new UnauthorizedException('Session invalide ou expirée.');
    return payload;
  }

  private sign(user: User) {
    return signToken({ sub: user.id, role: user.role, exp: Date.now() + 24 * 3600 * 1000 }, config.jwtSecret);
  }
}

/** Ce que le navigateur a le droit de voir (jamais le hash du mot de passe). */
export function publicUser(user: User) {
  const { passwordHash, seenScenarios, link, ...rest } = user;
  return {
    ...rest, driftThreshold: config.driftThreshold,
    // L'identifiant de liaison est un secret (il entre dans le code persona) : jamais envoyé au navigateur.
    link: link?.status === 'active' ? { partner: link.partner, linkedAt: link.linkedAt } : null,
  };
}
