import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { safeEqual } from '../../shared/local-auth';
import { ExternalPlatform, User } from '../domain/types';
import { EventsService } from '../realtime/events.service';
import { Store } from '../storage/store';

const TOKEN_RE = /^wk_([0-9a-f-]{36})_([A-Za-z0-9_-]{32})$/;
const MAX_PLATFORMS = 5;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Jeton personnel + comptes sur d'autres plateformes : permet à l'utilisateur d'utiliser WorthKnowing
 * depuis une plateforme qui n'est pas partenaire (sans liaison Boréal).
 *
 * Une plateforme doit présenter DEUX éléments à chaque appel de /api/connect/v1 :
 *   1. le jeton personnel `wk_<id>_<secret>` que l'utilisateur lui a confié ;
 *   2. l'identifiant de compte que l'utilisateur a lui-même déclaré pour cette plateforme.
 * Le jeton est aléatoire (192 bits), stocké seulement sous forme d'empreinte, montré une seule fois,
 * régénérable et révocable. Retirer une plateforme coupe son accès sans toucher aux autres.
 */
@Injectable()
export class ConnectService {
  constructor(private store: Store, private events: EventsService) {}

  /** Ce que l'utilisateur voit de son jeton et de ses plateformes (jamais l'empreinte). */
  status(user: User) {
    const t = user.accessToken;
    return {
      token: t ? { hint: t.hint, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt ?? null } : null,
      platforms: user.platforms ?? [],
    };
  }

  /** Crée (ou remplace) le jeton. Le jeton en clair (token.value) n'est renvoyé qu'ici : l'ancien cesse aussitôt de fonctionner. */
  async createToken(user: User) {
    if (!user.profile) throw new ConflictException('Terminez votre évaluation avant de créer votre jeton.');
    const token = `wk_${user.id}_${randomBytes(24).toString('base64url')}`;
    if (!TOKEN_RE.test(token)) throw new Error('Identifiant utilisateur inattendu pour un jeton.');
    user.accessToken = { hash: sha256(token), hint: `wk_…${token.slice(-4)}`, createdAt: new Date().toISOString() };
    await this.store.saveUser(user);
    this.events.emit('link.created', user, 'Jeton personnel créé');
    return { ...this.status(user), token: { ...this.status(user).token!, value: token } };
  }

  async revokeToken(user: User) {
    user.accessToken = null;
    await this.store.saveUser(user);
    this.events.emit('link.revoked', user, 'Jeton personnel révoqué');
    return this.status(user);
  }

  async addPlatform(user: User, name: unknown, accountId: unknown) {
    const n = typeof name === 'string' ? name.trim() : '';
    const a = typeof accountId === 'string' ? accountId.trim() : '';
    if (!n || n.length > 60) throw new BadRequestException('Nom de plateforme requis (60 caractères max.).');
    if (!/^[\w.@:+-]{1,100}$/.test(a)) {
      throw new BadRequestException('Identifiant de compte invalide (100 caractères max. : lettres, chiffres, . _ - @ : +).');
    }
    const platforms = user.platforms ?? [];
    if (platforms.length >= MAX_PLATFORMS) throw new BadRequestException(`${MAX_PLATFORMS} plateformes au maximum.`);
    if (platforms.some((p) => p.accountId.toLowerCase() === a.toLowerCase() && p.name.toLowerCase() === n.toLowerCase())) {
      throw new ConflictException('Ce compte est déjà enregistré.');
    }
    const platform: ExternalPlatform = { id: randomUUID(), name: n, accountId: a, addedAt: new Date().toISOString() };
    user.platforms = [...platforms, platform];
    await this.store.saveUser(user);
    this.events.emit('link.created', user, `Plateforme ajoutée : ${n}`);
    return this.status(user);
  }

  async removePlatform(user: User, id: string) {
    const platform = (user.platforms ?? []).find((p) => p.id === id);
    if (!platform) throw new NotFoundException('Plateforme introuvable.');
    user.platforms = (user.platforms ?? []).filter((p) => p.id !== id);
    await this.store.saveUser(user);
    this.events.emit('link.revoked', user, `Plateforme retirée : ${platform.name}`);
    return this.status(user);
  }

  /** Appel d'une plateforme : jeton valide ET identifiant de compte déclaré par l'utilisateur. */
  async resolve(token: unknown, accountId: unknown): Promise<{ user: User; platform: ExternalPlatform }> {
    const denied = new UnauthorizedException('Jeton ou identifiant de compte invalide.');
    const match = typeof token === 'string' ? TOKEN_RE.exec(token.trim()) : null;
    if (!match || typeof accountId !== 'string') throw denied;
    const user = await this.store.getUser(match[1]);
    if (!user?.accessToken || !safeEqual(sha256(token as string), user.accessToken.hash)) throw denied;
    const platform = (user.platforms ?? []).find((p) => p.accountId.toLowerCase() === accountId.trim().toLowerCase());
    if (!platform) throw denied; // même message : on ne révèle pas lequel des deux est faux
    const now = new Date().toISOString();
    user.accessToken.lastUsedAt = now;
    platform.lastUsedAt = now;
    await this.store.saveUser(user);
    return { user, platform };
  }
}
