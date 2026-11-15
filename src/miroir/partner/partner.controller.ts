import { Body, Controller, Delete, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { config } from '../config';
import { TradeRequest, TradesService } from '../trades/trades.service';
import { LinkService } from './link.service';
import { PartnerGuard, PersonaGuard } from './partner.guard';

/**
 * API partenaire v1 — appelée de serveur à serveur par la plateforme de courtage.
 *   En-têtes : x-partner-key (toujours) et x-persona-code (toutes les routes sauf l'échange du code).
 * C'est la seule porte d'entrée des trades dans Miroir.
 */
@Controller('api/partner/v1')
export class PartnerController {
  constructor(private links: LinkService, private trades: TradesService) {}

  /** Échange le code à usage unique reçu dans l'URL de retour contre le code persona. */
  @Post('link/exchange')
  @HttpCode(200)
  @UseGuards(PartnerGuard)
  exchange(@Body() body: { code: string }) { return this.links.exchange(body?.code); }

  /** Le courtier (ou son client) met fin à la liaison. */
  @Delete('link')
  @UseGuards(PersonaGuard)
  revoke(@Req() req: any) { return this.links.revoke(req.user); }

  /** État du persona : statut, dérive, règles. */
  @Get('persona')
  @UseGuards(PersonaGuard)
  persona(@Req() req: any) { return this.links.summary(req.user); }

  /** AVANT un trade : y a-t-il une règle personnelle à rappeler au client ? Aucun effet sur le profil. */
  @Post('trades/check')
  @HttpCode(200)
  @UseGuards(PersonaGuard)
  check(@Req() req: any, @Body() body: TradeRequest) { return this.trades.check(req.user, body); }

  /** Le client a renoncé au trade après le rappel de sa règle. */
  @Post('trades/abandon')
  @HttpCode(200)
  @UseGuards(PersonaGuard)
  abandon(@Req() req: any, @Body() body: TradeRequest) { return this.trades.abandon(req.user, body); }

  /** APRÈS un trade exécuté : enquête, mise à jour du profil et du score de dérive. */
  @Post('trades')
  @UseGuards(PersonaGuard)
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
