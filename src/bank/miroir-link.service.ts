import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { safeEqual } from '../shared/local-auth';
import { config } from './config';
import { MiroirClient, MiroirError, MiroirPersona } from './miroir.client';
import { BankStore } from './store';
import { Account } from './types';

/**
 * Le service Miroir est FACULTATIF pour un compte de courtage :
 *
 *   offre refusée   -> compte ordinaire (l'historique des trades est simplement conservé) ;
 *   offre acceptée  -> start()    : le client est envoyé chez Miroir, où il crée son compte et son profil ;
 *                      complete() : à son retour, le code rapporté est échangé contre son CODE PERSONA ;
 *   à tout moment   -> unlink()   : retour au compte ordinaire ; l'option reste dans les réglages.
 */
@Injectable()
export class MiroirLinkService {
  constructor(private store: BankStore, private miroir: MiroirClient) {}

  /** Adresse de retour : la page principale de la plateforme (elle lit ?code= et ?state=). */
  private returnUrl = `${config.publicUrl}/app.html`;

  /** Le client refuse l'offre (ou la remet à plus tard). */
  async decline(account: Account) {
    if (account.miroir.status !== 'linked') {
      account.miroir = { status: 'declined' };
      await this.store.saveAccount(account);
    }
    return { status: account.miroir.status };
  }

  /** Le client accepte : on mémorise un `state` aléatoire et on retourne l'adresse Miroir où l'envoyer. */
  async start(account: Account) {
    if (account.miroir.status === 'linked') throw new ConflictException('Ce compte est déjà lié à Miroir.');
    account.miroir = { status: 'pending', state: randomBytes(16).toString('hex') };
    await this.store.saveAccount(account);
    const url = new URL(config.miroir.publicUrl + '/');
    url.searchParams.set('link', '1');
    url.searchParams.set('state', account.miroir.state!);
    url.searchParams.set('return', this.returnUrl);
    return { redirectUrl: url.toString() };
  }

  /** Retour de Miroir : vérifie le `state`, puis échange le code (serveur à serveur) contre le code persona. */
  async complete(account: Account, code: string, state: string) {
    const expected = account.miroir.state;
    if (account.miroir.status !== 'pending' || !expected || !safeEqual(String(state ?? ''), expected)) {
      throw new BadRequestException('Cette demande de liaison ne correspond pas à votre compte. Recommencez depuis les réglages.');
    }
    try {
      const { personaCode, persona } = await this.miroir.exchange(String(code ?? ''), account.id);
      account.miroir = { status: 'linked', personaCode, linkedAt: new Date().toISOString() };
      await this.store.saveAccount(account);
      return { status: 'linked', persona };
    } catch (err) {
      if (err instanceof MiroirError && err.status === 0) throw new ServiceUnavailableException(err.message);
      throw new BadRequestException((err as Error).message);
    }
  }

  /**
   * Appelé par Miroir (serveur à serveur, clé partenaire vérifiée par le contrôleur) quand le client régénère
   * son user id : on remplace le code persona, sans aucune action du client.
   */
  async updatePersonaCode(accountId: unknown, personaCode: unknown) {
    const account = typeof accountId === 'string' ? await this.store.getAccount(accountId) : undefined;
    if (!account || account.miroir.status !== 'linked' || typeof personaCode !== 'string' || !personaCode.startsWith('wk_')) {
      throw new BadRequestException('Compte lié ou code persona invalide.');
    }
    account.miroir.personaCode = personaCode;
    await this.store.saveAccount(account);
    return { ok: true };
  }

  /** Le client retire Miroir de son compte. On prévient Miroir, sans en dépendre. */
  async unlink(account: Account) {
    const code = account.miroir.personaCode;
    if (code) await this.miroir.revoke(code).catch(() => undefined);
    account.miroir = { status: 'declined' };
    await this.store.saveAccount(account);
    return { status: 'declined' };
  }

  /** État du profil Miroir du client (dérive, règles), ou null si Miroir ne répond pas. */
  async persona(account: Account): Promise<MiroirPersona | null> {
    if (account.miroir.status !== 'linked') return null;
    try {
      return await this.miroir.persona(account.miroir.personaCode!);
    } catch (err) {
      await this.handleRevoked(account, err);
      return null;
    }
  }

  /** Miroir refuse le code persona (401) : le client a révoqué la liaison de son côté -> compte ordinaire. */
  async handleRevoked(account: Account, err: unknown) {
    if (err instanceof MiroirError && err.status === 401 && account.miroir.status === 'linked') {
      account.miroir = { status: 'declined' };
      await this.store.saveAccount(account);
    }
  }

  /** Adresses Miroir utiles au navigateur. */
  urls() {
    const reevaluate = new URL(config.miroir.publicUrl + '/');
    reevaluate.searchParams.set('return', this.returnUrl);
    return { profile: config.miroir.publicUrl + '/', reevaluate: reevaluate.toString() };
  }
}
