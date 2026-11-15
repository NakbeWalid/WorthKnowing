import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { safeEqual } from '../../shared/local-auth';
import { config } from '../config';
import { LinkService } from './link.service';

/** Authentifie le serveur du courtier par sa clé d'API (en-tête x-partner-key). */
@Injectable()
export class PartnerGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean | Promise<boolean> {
    const key = ctx.switchToHttp().getRequest().headers['x-partner-key'];
    if (typeof key !== 'string' || !safeEqual(key, config.partner.apiKey)) {
      throw new UnauthorizedException('Clé partenaire invalide.');
    }
    return true;
  }
}

/** En plus de la clé partenaire, identifie le persona par son code (en-tête x-persona-code) -> `req.user`. */
@Injectable()
export class PersonaGuard extends PartnerGuard {
  constructor(private links: LinkService) {
    super();
  }

  async canActivate(ctx: ExecutionContext) {
    await super.canActivate(ctx);
    const req = ctx.switchToHttp().getRequest();
    req.user = await this.links.resolve(req.headers['x-persona-code']);
    return true;
  }
}
