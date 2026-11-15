import { Body, Controller, Get, Headers, HttpCode, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { safeEqual } from '../shared/local-auth';
import { MarketService } from '../shared/market.service';
import { BankAuthGuard } from './auth';
import { config } from './config';
import { MiroirLinkService } from './miroir-link.service';
import { TradingService } from './trading.service';
import { Account, TradeInput } from './types';

/** Compte, marché et ordres du client connecté. */
@Controller('api')
@UseGuards(BankAuthGuard)
export class TradingController {
  constructor(private trading: TradingService, private market: MarketService, private links: MiroirLinkService) {}

  /** Tout ce dont la page principale a besoin : identité, portefeuille, état du service Miroir. */
  @Get('me')
  async me(@Req() req: { account: Account }) {
    const a = req.account;
    return {
      name: a.name, email: a.email, createdAt: a.createdAt,
      portfolio: this.trading.portfolio(a),
      /** Date de marché simulée du dernier ordre : les suivants ne peuvent pas être antérieurs. */
      clock: a.asOf ?? null,
      // Le code persona ne quitte jamais le serveur : le navigateur ne voit que l'état de la liaison.
      miroir: { status: a.miroir.status, linkedAt: a.miroir.linkedAt ?? null, urls: this.links.urls() },
      startingCash: config.startingCash,
    };
  }

  @Get('market/assets')
  assets() { return { firstDate: this.market.firstDate, lastDate: this.market.lastDate, assets: this.market.listAssets() }; }

  @Get('market/quote')
  quote(@Query('ticker') ticker: string, @Query('date') date?: string) { return this.trading.quote(ticker, date); }

  @Get('trades')
  history(@Req() req: { account: Account }) { return this.trading.history(req.account); }

  /** Avant confirmation : cotation + rappel éventuel des règles Miroir. Aucun effet. */
  @Post('trades/preview')
  @HttpCode(200)
  preview(@Req() req: { account: Account }, @Body() body: TradeInput) { return this.trading.preview(req.account, body); }

  /** Le client renonce après le rappel d'une règle. */
  @Post('trades/cancel')
  @HttpCode(200)
  cancel(@Req() req: { account: Account }, @Body() body: TradeInput) { return this.trading.cancel(req.account, body); }

  /** Exécute l'ordre, l'ajoute à l'historique et, si le compte est lié, l'envoie à Miroir. */
  @Post('trades')
  execute(@Req() req: { account: Account }, @Body() body: TradeInput) { return this.trading.execute(req.account, body); }
}

/** Activation, refus et retrait du service Miroir pour le compte connecté. */
@Controller('api/miroir')
@UseGuards(BankAuthGuard)
export class MiroirController {
  constructor(private links: MiroirLinkService) {}

  @Get('persona')
  persona(@Req() req: { account: Account }) { return this.links.persona(req.account).then((persona) => ({ persona })); }

  @Post('decline')
  @HttpCode(200)
  decline(@Req() req: { account: Account }) { return this.links.decline(req.account); }

  @Post('link/start')
  @HttpCode(200)
  start(@Req() req: { account: Account }) { return this.links.start(req.account); }

  @Post('link/complete')
  @HttpCode(200)
  complete(@Req() req: { account: Account }, @Body() body: { code: string; state: string }) {
    return this.links.complete(req.account, body?.code, body?.state);
  }

  @Post('unlink')
  @HttpCode(200)
  unlink(@Req() req: { account: Account }) { return this.links.unlink(req.account); }
}

/** Sonde de santé pour l'équilibreur de charge. */
/** Notifications envoyées par Miroir (serveur à serveur), authentifiées par la clé partenaire. */
@Controller('api/partner-webhook')
export class PartnerWebhookController {
  constructor(private links: MiroirLinkService) {}

  @Post('persona-code')
  @HttpCode(200)
  personaCode(@Headers('x-partner-key') key: string, @Body() body: { accountId: string; personaCode: string }) {
    if (typeof key !== 'string' || !safeEqual(key, config.miroir.apiKey)) throw new UnauthorizedException('Clé partenaire invalide.');
    return this.links.updatePersonaCode(body?.accountId, body?.personaCode);
  }
}

@Controller('api/health')
export class BankHealthController {
  @Get()
  health() { return { app: 'boreal', ok: true }; }
}
