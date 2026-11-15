import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Decision, ParamKey } from '../domain/types';
import { EvaluationService } from './evaluation.service';

@Controller('api/evaluation')
@UseGuards(AuthGuard)
export class EvaluationController {
  constructor(private evaluation: EvaluationService) {}

  /** Étape 1 — questions « comment vous voyez-vous ? » */
  @Get('questions')
  questions() { return this.evaluation.questions(); }

  /** Étape 2 — démarre les simulations (answers facultatif lors d'une réévaluation). */
  @Post('start')
  start(@Req() req: any, @Body() body: { answers?: Record<string, string> }) {
    return this.evaluation.start(req.user, body.answers);
  }

  @Post(':id/decisions')
  decide(@Req() req: any, @Param('id') id: string, @Body() body: Decision) {
    return this.evaluation.decide(req.user, id, body);
  }

  /** Étape 3 — révélation + diagnostic du profil. */
  @Post(':id/complete')
  complete(@Req() req: any, @Param('id') id: string) {
    return this.evaluation.complete(req.user, id);
  }

  /** Étape 4 — règles auto-définies ; active le profil et remet la dérive à zéro. */
  @Post(':id/rules')
  finalize(@Req() req: any, @Param('id') id: string,
    @Body() body: { rules: { param: ParamKey; text: string; threshold: number }[] }) {
    return this.evaluation.finalize(req.user, id, body.rules);
  }
}
