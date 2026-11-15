import { Body, Controller, Get, HttpCode, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ParamKey } from '../domain/types';
import { RulesService } from './rules.service';

@Controller('api/rules')
@UseGuards(AuthGuard)
export class RulesController {
  constructor(private rulesService: RulesService) {}

  /** Récupère les règles courantes avec suggestions intelligentes. */
  @Get()
  getRules(@Req() req: any) {
    return this.rulesService.getSmartRules(req.user);
  }

  /** Modifie ou remplace l'ensemble des règles n'importe quand. */
  @Put()
  saveRules(
    @Req() req: any,
    @Body() body: { rules: Array<{ param: ParamKey; text: string; threshold: number }>; resetDrift?: boolean },
  ) {
    return this.rulesService.saveRules(req.user, body?.rules ?? [], Boolean(body?.resetDrift));
  }

  /** Alias POST pour enregistrer des règles. */
  @Post()
  updateRules(
    @Req() req: any,
    @Body() body: { rules: Array<{ param: ParamKey; text: string; threshold: number }>; resetDrift?: boolean },
  ) {
    return this.rulesService.saveRules(req.user, body?.rules ?? [], Boolean(body?.resetDrift));
  }

  /** Quand on dépasse le seuil de dérive : invite le user à refaire ses règles et reset à 0. */
  @Post('reset-drift')
  @HttpCode(200)
  resetDrift(@Req() req: any) {
    return this.rulesService.resetDrift(req.user);
  }
}
