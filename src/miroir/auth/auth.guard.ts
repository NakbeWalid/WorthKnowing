import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Store } from '../storage/store';
import { AuthService } from './auth.service';

/** Vérifie le jeton (en-tête Authorization, ou ?token= pour le flux SSE) et attache `req.user`. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private auth: AuthService, private store: Store) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const token = (req.headers.authorization ?? '').replace('Bearer ', '') || req.query.token;
    const payload = await this.auth.verify(token);
    const user = await this.store.getUser(payload.sub);
    if (!user) throw new UnauthorizedException('Utilisateur introuvable.');
    // Le rôle fait foi depuis le jeton (groupe Cognito « admin » en mode cognito).
    req.user = { ...user, role: payload.role };
    return true;
  }
}

/** Réserve une route aux administrateurs. */
@Injectable()
export class AdminGuard extends AuthGuard {
  async canActivate(ctx: ExecutionContext) {
    await super.canActivate(ctx);
    if (ctx.switchToHttp().getRequest().user.role !== 'admin') throw new ForbiddenException('Accès administrateur requis.');
    return true;
  }
}
