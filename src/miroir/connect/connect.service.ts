import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'crypto';
import { safeEqual } from '../../shared/local-auth';
import { config } from '../config';
import { ExternalPlatform, User } from '../domain/types';
import { EventsService } from '../realtime/events.service';
import { Store } from '../storage/store';

const TOKEN_RE = /^wk_([0-9a-f-]{36})_([A-Za-z0-9_-]{32})$/;
const MAX_MANUAL_PLATFORMS = 5;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
/** Clé de chiffrement du jeton, dérivée du secret de liaison (Secrets Manager en production). */
const KEY = createHash('sha256').update(`wk-token:${config.linkSecret}`).digest();

/**
 * Jeton personnel WorthKnowing (« user id token ») et plateformes de l'utilisateur.
 *
 *  - Le jeton est créé automatiquement (première visite du profil après l'évaluation, ou première liaison).
 *    Il est toujours visible par l'utilisateur ; il ne peut être ni créé à la main ni supprimé, seulement régénéré.
 *    Stockage : empreinte SHA-256 (vérification) + copie chiffrée AES-256-GCM (affichage).
 *  - Plateforme liée (Boréal) : ajoutée automatiquement à la liaison, avec l'identifiant de compte envoyé par la
 *    plateforme. Le jeton lui sert de code persona ; à chaque régénération, Miroir lui envoie le nouveau jeton.
 *  - Plateforme ajoutée à la main : l'utilisateur saisit son identifiant de compte ; la plateforme appelle
 *    /api/connect/v1 avec le jeton ET cet identifiant.
 */
@Injectable()
export class ConnectService {
  private log = new Logger('Connect');
  constructor(private store: Store, private events: EventsService) {}

  /** Crée le jeton s'il n'existe pas encore. Retourne true si l'utilisateur a été modifié (à sauvegarder). */
  ensureToken(user: User): boolean {
    if (user.accessToken) return false;
    this.setToken(user, this.newToken(user));
    return true;
  }

  /** Jeton en clair (pour l'utilisateur lui-même, ou pour l'envoyer à la plateforme liée). */
  tokenValue(user: User): string {
    const [iv, tag, data] = user.accessToken!.enc.split('.').map((p) => Buffer.from(p, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf-8');
  }

  /** Vue de l'utilisateur : son jeton (créé au besoin) et ses plateformes. */
  async status(user: User) {
    if (user.profile && this.ensureToken(user)) await this.store.saveUser(user);
    const t = user.accessToken;
    return {
      token: t ? { value: this.tokenValue(user), createdAt: t.createdAt } : null,
      platforms: (user.platforms ?? []).map(({ id, name, accountId, source, addedAt, lastUsedAt }) =>
        ({ id, name, accountId, source, addedAt, lastUsedAt: lastUsedAt ?? null })),
    };
  }

  /**
   * Nouveau jeton. La plateforme liée est prévenue AVANT l'enregistrement : si elle ne répond pas, rien ne
   * change (l'ancien jeton reste valable partout) et l'utilisateur peut réessayer.
   */
  async regenerate(user: User) {
    if (!user.accessToken) throw new ConflictException('Terminez votre évaluation : votre jeton sera créé automatiquement.');
    const token = this.newToken(user);
    const linked = this.linkedPlatform(user);
    if (linked) await this.notifyPartner(linked.accountId, token);
    this.setToken(user, token);
    await this.store.saveUser(user);
    this.events.emit('link.created', user, `Jeton régénéré${linked ? ` — ${linked.name} mis à jour automatiquement` : ''}`);
    const manual = (user.platforms ?? []).filter((p) => p.source === 'manual').map((p) => p.name);
    return { ...(await this.status(user)), partnerUpdated: linked?.name ?? null, manualPlatforms: manual };
  }

  async addPlatform(user: User, name: unknown, accountId: unknown) {
    if (!user.profile) throw new ConflictException('Terminez votre évaluation avant d’ajouter une plateforme.');
    const n = typeof name === 'string' ? name.trim() : '';
    const a = typeof accountId === 'string' ? accountId.trim() : '';
    if (!n || n.length > 60) throw new BadRequestException('Nom de plateforme requis (60 caractères max.).');
    if (!/^[\w.@:+-]{1,100}$/.test(a)) {
      throw new BadRequestException('Identifiant de compte invalide (100 caractères max. : lettres, chiffres, . _ - @ : +).');
    }
    const platforms = user.platforms ?? [];
    if (platforms.filter((p) => p.source === 'manual').length >= MAX_MANUAL_PLATFORMS) {
      throw new BadRequestException(`${MAX_MANUAL_PLATFORMS} plateformes ajoutées à la main au maximum.`);
    }
    if (platforms.some((p) => p.accountId.toLowerCase() === a.toLowerCase())) throw new ConflictException('Cet identifiant est déjà enregistré.');
    this.ensureToken(user);
    user.platforms = [...platforms, { id: randomUUID(), name: n, accountId: a, source: 'manual', addedAt: new Date().toISOString() }];
    await this.store.saveUser(user);
    this.events.emit('link.created', user, `Plateforme ajoutée : ${n}`);
    return this.status(user);
  }

  /** Seules les plateformes ajoutées à la main se retirent ici ; la plateforme liée se retire par la liaison. */
  async removePlatform(user: User, id: string) {
    const platform = (user.platforms ?? []).find((p) => p.id === id);
    if (!platform) throw new NotFoundException('Plateforme introuvable.');
    if (platform.source === 'link') throw new BadRequestException(`Pour retirer ${platform.name}, retirez son accès (carte « Compte de courtage »).`);
    user.platforms = (user.platforms ?? []).filter((p) => p.id !== id);
    await this.store.saveUser(user);
    this.events.emit('link.revoked', user, `Plateforme retirée : ${platform.name}`);
    return this.status(user);
  }

  // ------------------------------------------------------------ utilisé par la liaison (LinkService)

  /** Liaison réussie : la plateforme et l'identifiant de compte qu'elle a envoyé sont enregistrés automatiquement. */
  setLinkedPlatform(user: User, name: string, accountId: string) {
    this.ensureToken(user);
    const others = (user.platforms ?? []).filter((p) => p.source !== 'link');
    user.platforms = [{ id: randomUUID(), name, accountId, source: 'link', addedAt: new Date().toISOString() }, ...others];
  }

  removeLinkedPlatform(user: User) {
    user.platforms = (user.platforms ?? []).filter((p) => p.source !== 'link');
  }

  linkedPlatform(user: User): ExternalPlatform | undefined {
    return user.link?.status === 'active' ? (user.platforms ?? []).find((p) => p.source === 'link') : undefined;
  }

  /** À qui appartient ce jeton ? (vérification par empreinte, en temps constant) */
  async userForToken(token: unknown): Promise<User | undefined> {
    const match = typeof token === 'string' ? TOKEN_RE.exec(token.trim()) : null;
    if (!match) return undefined;
    const user = await this.store.getUser(match[1]);
    return user?.accessToken && safeEqual(sha256(token as string), user.accessToken.hash) ? user : undefined;
  }

  /** Appel d'une plateforme ajoutée à la main : jeton valide ET identifiant de compte déclaré par l'utilisateur. */
  async resolveManual(token: unknown, accountId: unknown): Promise<{ user: User; platform: ExternalPlatform }> {
    const denied = new UnauthorizedException('Jeton ou identifiant de compte invalide.');
    const user = await this.userForToken(token);
    if (!user || typeof accountId !== 'string') throw denied;
    const platform = (user.platforms ?? []).find((p) => p.source === 'manual' && p.accountId.toLowerCase() === accountId.trim().toLowerCase());
    if (!platform) throw denied; // même message : on ne révèle pas lequel des deux est faux
    platform.lastUsedAt = new Date().toISOString();
    await this.store.saveUser(user);
    return { user, platform };
  }

  // ------------------------------------------------------------ privé

  private newToken(user: User) {
    const token = `wk_${user.id}_${randomBytes(24).toString('base64url')}`;
    if (!TOKEN_RE.test(token)) throw new Error('Identifiant utilisateur inattendu pour un jeton.');
    return token;
  }

  private setToken(user: User, token: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', KEY, iv);
    const data = Buffer.concat([cipher.update(token, 'utf-8'), cipher.final()]);
    const enc = [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
    user.accessToken = { hash: sha256(token), enc, createdAt: new Date().toISOString() };
  }

  /** Envoie le nouveau jeton à la plateforme liée (serveur à serveur, avec la clé partenaire). */
  private async notifyPartner(accountId: string, personaCode: string) {
    try {
      const res = await fetch(config.partner.tokenWebhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-partner-key': config.partner.apiKey },
        body: JSON.stringify({ accountId, personaCode }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) throw new Error(`réponse ${res.status}`);
    } catch (err) {
      this.log.warn(`mise à jour du partenaire impossible : ${(err as Error).message}`);
      throw new ServiceUnavailableException(`${config.partner.name} n’a pas pu être mis à jour : votre jeton n’a pas changé. Réessayez dans un instant.`);
    }
  }
}
