import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { signToken, verifyToken } from '../../shared/local-auth';
import { config } from '../config';
import { User } from '../domain/types';
import { EventsService } from '../realtime/events.service';
import { Store } from '../storage/store';

interface CodePayload { t: 'code' | 'persona'; uid: string; lid: string; exp?: number }
const CODE_TTL_MS = 5 * 60 * 1000;
const PERSONA_PREFIX = 'mir_';

/**
 * Liaison entre un compte Miroir et un compte de la plateforme de courtage (même principe qu'OAuth) :
 *
 *   1. l'utilisateur, connecté à Miroir, autorise la liaison          -> authorize()  : code à usage unique (5 min),
 *      renvoyé au courtier dans l'URL de retour ;
 *   2. le serveur du courtier échange ce code (avec sa clé d'API)      -> exchange()   : CODE PERSONA durable ;
 *   3. chaque requête de trade du courtier porte le code persona       -> resolve()    : retrouve le bon profil.
 *
 * Les deux codes sont signés (HMAC) et contiennent l'identifiant de la liaison en cours : révoquer ou
 * refaire la liaison change cet identifiant, et les anciens codes cessent d'être acceptés. Rien à stocker de plus.
 * Le code de l'URL ne vaut rien sans la clé d'API du courtier ; le code persona ne transite que de serveur à serveur.
 */
@Injectable()
export class LinkService {
  constructor(private store: Store, private events: EventsService) {}

  /** Nom du partenaire si l'URL de retour lui appartient, sinon undefined (anti redirection ouverte). */
  partnerFor(returnUrl: string): string | undefined {
    try {
      return config.partner.returnOrigins.includes(new URL(returnUrl).origin) ? config.partner.name : undefined;
    } catch {
      return undefined;
    }
  }

  /** Étape 1 — l'utilisateur autorise : retourne l'URL du courtier complétée du code à usage unique. */
  async authorize(user: User, state: string, returnUrl: string) {
    if (!this.partnerFor(returnUrl)) throw new BadRequestException('Adresse de retour non autorisée.');
    if (typeof state !== 'string' || !state || state.length > 200) throw new BadRequestException('Paramètre state invalide.');
    if (!user.profile) throw new ConflictException('Terminez votre évaluation avant de lier votre compte.');
    user.link = { id: randomUUID(), partner: config.partner.name, status: 'pending', createdAt: new Date().toISOString() };
    await this.store.saveUser(user);
    const code = signToken({ t: 'code', uid: user.id, lid: user.link.id, exp: Date.now() + CODE_TTL_MS }, config.linkSecret);
    const url = new URL(returnUrl);
    url.searchParams.set('code', code);
    url.searchParams.set('state', state);
    return { redirectUrl: url.toString() };
  }

  /** Étape 2 — appelée par le serveur du courtier : code à usage unique -> code persona. */
  async exchange(code: string) {
    const payload = verifyToken<CodePayload>(code, config.linkSecret);
    const user = payload?.t === 'code' ? await this.store.getUser(payload.uid) : undefined;
    // « pending » garantit l'usage unique : dès le premier échange la liaison passe à « active ».
    if (!user?.link || user.link.id !== payload!.lid || user.link.status !== 'pending') {
      throw new UnauthorizedException('Code de liaison invalide, expiré ou déjà utilisé.');
    }
    user.link.status = 'active';
    user.link.linkedAt = new Date().toISOString();
    await this.store.saveUser(user);
    this.events.emit('link.created', user, `Compte lié à ${user.link.partner}`);
    const personaCode = PERSONA_PREFIX + signToken({ t: 'persona', uid: user.id, lid: user.link.id }, config.linkSecret);
    return { personaCode, persona: this.summary(user) };
  }

  /** Étape 3 — à chaque requête du courtier : à quel persona appartient ce trade ? */
  async resolve(personaCode: string): Promise<User> {
    const raw = String(personaCode ?? '');
    const payload = raw.startsWith(PERSONA_PREFIX)
      ? verifyToken<CodePayload>(raw.slice(PERSONA_PREFIX.length), config.linkSecret) : undefined;
    const user = payload?.t === 'persona' ? await this.store.getUser(payload.uid) : undefined;
    if (!user?.link || user.link.id !== payload!.lid || user.link.status !== 'active') {
      throw new UnauthorizedException('Code persona invalide ou liaison révoquée.');
    }
    return user;
  }

  /** Fin de la liaison, demandée par l'utilisateur (côté Miroir) ou par le courtier. */
  async revoke(user: User) {
    if (!user.link) return { ok: true };
    const partner = user.link.partner;
    user.link = null;
    await this.store.saveUser(user);
    this.events.emit('link.revoked', user, `Liaison avec ${partner} révoquée`);
    return { ok: true };
  }

  /** Ce que le courtier a le droit de savoir du persona : l'état, la dérive et le texte des règles. Pas le profil. */
  summary(user: User) {
    return {
      status: user.status,
      drift: { score: user.drift.score, threshold: config.driftThreshold },
      evaluatedAt: user.profile?.evaluatedAt ?? null,
      rules: user.rules.map((r) => ({ id: r.id, param: r.param, text: r.text.replace('{seuil}', String(r.threshold)) })),
    };
  }
}
