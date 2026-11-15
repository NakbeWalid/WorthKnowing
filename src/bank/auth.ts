import {
  BadRequestException, Body, CanActivate, ConflictException, Controller, ExecutionContext, HttpCode, Injectable, Post,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { checkPassword, hashPassword, signToken, verifyToken } from '../shared/local-auth';
import { config } from './config';
import { BankStore } from './store';
import { Account } from './types';

/**
 * Comptes clients de la plateforme de courtage : mot de passe haché + jeton signé (24 h).
 * Ces comptes n'ont rien à voir avec les comptes Miroir : le client en crée un second chez Miroir s'il active le service.
 */
@Injectable()
export class BankAuthService {
  constructor(private store: BankStore) {}

  async register(email: string, password: string, name: string) {
    email = String(email ?? '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email) || !String(name ?? '').trim() || String(password ?? '').length < 8) {
      throw new BadRequestException('Courriel valide, prénom et mot de passe de 8 caractères minimum requis.');
    }
    if (await this.store.getAccountByEmail(email)) throw new ConflictException('Un compte existe déjà avec ce courriel.');
    const account: Account = {
      id: randomUUID(), email, name: String(name).trim().slice(0, 80), passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(), cash: config.startingCash, positions: {}, miroir: { status: 'none' },
    };
    await this.store.saveAccount(account);
    return { token: this.sign(account) };
  }

  async login(email: string, password: string) {
    const account = await this.store.getAccountByEmail(String(email ?? ''));
    if (!account || !checkPassword(String(password ?? ''), account.passwordHash)) {
      throw new UnauthorizedException('Courriel ou mot de passe invalide.');
    }
    return { token: this.sign(account) };
  }

  async accountFor(token: string): Promise<Account> {
    const payload = verifyToken<{ sub: string; exp: number }>(token, config.jwtSecret);
    const account = payload && (await this.store.getAccount(payload.sub));
    if (!account) throw new UnauthorizedException('Session invalide ou expirée.');
    return account;
  }

  private sign(account: Account) {
    return signToken({ sub: account.id, exp: Date.now() + 24 * 3600 * 1000 }, config.jwtSecret);
  }
}

/** Vérifie le jeton (en-tête Authorization) et attache le compte à `req.account`. */
@Injectable()
export class BankAuthGuard implements CanActivate {
  constructor(private auth: BankAuthService) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    req.account = await this.auth.accountFor(String(req.headers.authorization ?? '').replace('Bearer ', ''));
    return true;
  }
}

@Controller('api/auth')
export class BankAuthController {
  constructor(private auth: BankAuthService) {}

  @Post('register')
  register(@Body() body: { email: string; password: string; name: string }) {
    return this.auth.register(body?.email, body?.password, body?.name);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() body: { email: string; password: string }) {
    return this.auth.login(body?.email, body?.password);
  }
}
