import {
  Body, CanActivate, Controller, Delete, ExecutionContext, Get, HttpCode, Injectable, Param, Post, Req, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { config } from '../config';
import { LinkService } from '../partner/link.service';
import { TradeRequest, TradesService } from '../trades/trades.service';
import { ConnectService } from './connect.service';

/** Côté utilisateur (connecté) : voir et régénérer son user id, gérer ses identifiants chez les institutions. */
@Controller('api/connect')
@UseGuards(AuthGuard)
export class ConnectController {
  constructor(private connect: ConnectService) {}

  @Get()
  status(@Req() req: any) { return this.connect.status(req.user); }

  /** Seule action possible sur le user id : le régénérer (la plateforme liée reçoit le nouveau). */
  @Post('token/regenerate')
  @HttpCode(200)
  regenerate(@Req() req: any) { return this.connect.regenerate(req.user); }

  @Post('platforms')
  @HttpCode(200)
  addPlatform(@Req() req: any, @Body() body: { name: string; accountId: string }) {
    return this.connect.addPlatform(req.user, body?.name, body?.accountId);
  }

  @Delete('platforms/:id')
  removePlatform(@Req() req: any, @Param('id') id: string) { return this.connect.removePlatform(req.user, id); }
}

/** Plateforme ajoutée à la main : user id (x-wk-token) ET identifiant institution déclaré (x-platform-account). */
@Injectable()
export class ConnectGuard implements CanActivate {
  constructor(private connect: ConnectService) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const { user, platform } = await this.connect.resolveManual(req.headers['x-wk-token'], req.headers['x-platform-account']);
    req.user = user;
    req.platform = platform;
    return true;
  }
}

/**
 * API v1 pour les autres plateformes — mêmes services que l'API partenaire, mais l'accès est accordé
 * par l'utilisateur lui-même (jeton + compte déclaré) plutôt que par une liaison avec un partenaire connu.
 */
@Controller('api/connect/v1')
@UseGuards(ConnectGuard)
export class ConnectApiController {
  constructor(private links: LinkService, private trades: TradesService) {}

  /** État du persona : statut, dérive, règles (pas le profil détaillé). */
  @Get('persona')
  persona(@Req() req: any) { return { platform: req.platform.name, ...this.links.summary(req.user) }; }

  @Post('trades/check')
  @HttpCode(200)
  check(@Req() req: any, @Body() body: TradeRequest) { return this.trades.check(req.user, body); }

  @Post('trades/abandon')
  @HttpCode(200)
  abandon(@Req() req: any, @Body() body: TradeRequest) { return this.trades.abandon(req.user, body); }

  @Post('trades')
  async submit(@Req() req: any, @Body() body: TradeRequest) {
    const { trade, status, drift } = await this.trades.submit(req.user, body);
    return {
      tradeId: trade.id, status, reevaluationRequired: status === 'reevaluation_required',
      drift: { score: drift.score, before: trade.investigation.driftBefore, threshold: config.driftThreshold },
      overrodeRules: trade.overrodeRules,
      investigation: trade.investigation,
    };
  }
}
