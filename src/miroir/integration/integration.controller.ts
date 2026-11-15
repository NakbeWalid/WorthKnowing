import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { config } from '../config';
import { TradeRequest, TradesService } from '../trades/trades.service';
import { IntegrationGuard } from './integration.guard';

/**
 * API d'Intégration Bancaire Directe v1 — pour les banques et plateformes partenaires.
 * Authentification simple via Bank Integration Token (genre hash de l'identifiant utilisateur) :
 *   - En-tête : `x-integration-token: wk_live_...`
 *   - ou `Authorization: Bearer wk_live_...`
 */
@Controller('api/integration/v1')
@UseGuards(IntegrationGuard)
export class IntegrationController {
  constructor(private trades: TradesService) {}

  /** Récupère le persona comportemental complet du client bancaire. */
  @Get('persona')
  persona(@Req() req: any) {
    const user = req.user;
    return {
      userId: user.id,
      name: user.name,
      status: user.status,
      drift: {
        score: user.drift.score,
        threshold: config.driftThreshold,
        overrides: user.drift.overrides,
      },
      evaluatedAt: user.profile?.evaluatedAt ?? null,
      rules: user.rules.map((r: any) => ({
        id: r.id,
        param: r.param,
        text: r.text.replace('{seuil}', String(r.threshold)),
        threshold: r.threshold,
      })),
      criteriaHexagon: {
        declared: user.profile?.declared ?? null,
        baseline: user.profile?.baseline ?? null,
        current: user.profile?.current ?? null,
      },
    };
  }

  /**
   * AVANT un ordre : vérification des garde-fous et calcul de l'impact direct sur la dérive.
   * Retourne l'impact prévisionnel si le client brise une règle.
   */
  @Post('trades/check')
  @HttpCode(200)
  async checkTrade(@Req() req: any, @Body() body: TradeRequest) {
    return this.trades.check(req.user, body);
  }

  /** Le client renonce au trade après le rappel de sa règle. */
  @Post('trades/abandon')
  @HttpCode(200)
  async abandonTrade(@Req() req: any, @Body() body: TradeRequest) {
    return this.trades.abandon(req.user, body);
  }

  /**
   * APRÈS l'exécution de l'ordre bancaire : analyse WorthKnowing,
   * mise à jour du score de dérive et enregistrement des garde-fous brisés.
   */
  @Post('trades')
  async submitTrade(@Req() req: any, @Body() body: TradeRequest) {
    const { trade, status, drift } = await this.trades.submit(req.user, body);
    return {
      tradeId: trade.id,
      status,
      reevaluationRequired: status === 'reevaluation_required',
      drift: {
        score: drift.score,
        before: trade.investigation.driftBefore,
        threshold: config.driftThreshold,
        overrides: drift.overrides,
      },
      overrodeRules: trade.overrodeRules,
      derivationImpact: trade.investigation.derivationImpact,
      investigation: trade.investigation,
    };
  }

  /** Profil complet et historique des transactions analysées. */
  @Get('profile')
  async getProfile(@Req() req: any) {
    const user = req.user;
    const history = await this.trades.history(user);
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        status: user.status,
        drift: user.drift,
        profile: user.profile,
        rules: user.rules,
      },
      trades: history,
    };
  }
}
