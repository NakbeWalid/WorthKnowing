import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { generateBankIntegrationToken } from '../auth/auth.service';
import { Store } from '../storage/store';

@Injectable()
export class IntegrationGuard implements CanActivate {
  constructor(private store: Store) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const rawToken =
      req.headers['x-integration-token'] ||
      req.headers['x-bank-token'] ||
      (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null) ||
      req.query?.token;

    if (!rawToken || typeof rawToken !== 'string') {
      throw new UnauthorizedException(
        'Jeton d’intégration bancaire manquant. Fournissez x-integration-token ou Authorization: Bearer <token>.',
      );
    }

    const token = rawToken.trim();
    const users = await this.store.listUsers();
    const user = users.find(
      (u) =>
        u.bankIntegrationToken === token ||
        generateBankIntegrationToken(u.id) === token,
    );

    if (!user) {
      throw new UnauthorizedException('Jeton d’intégration bancaire invalide ou inconnu.');
    }

    req.user = user;
    return true;
  }
}
