import { Body, Controller, Get, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ParamKey } from '../domain/types';
import { RulesService } from './rules.service';

type RulesBody = { rules: Array<{ param: ParamKey; text: string; threshold: number }> };

/** Règles personnelles (gouvernance). Les modifier ne touche pas à la dérive : voir RulesService.saveRules. */
@Controller('api/rules')
@UseGuards(AuthGuard)
export class RulesController {
  constructor(private rulesService: RulesService) {}

  /** Règles courantes avec suggestions. */
  @Get()
  getRules(@Req() req: any) { return this.rulesService.getSmartRules(req.user); }

  /** Remplace l'ensemble des règles. */
  @Put()
  saveRules(@Req() req: any, @Body() body: RulesBody) { return this.rulesService.saveRules(req.user, body?.rules ?? []); }

  /** Alias POST. */
  @Post()
  updateRules(@Req() req: any, @Body() body: RulesBody) { return this.rulesService.saveRules(req.user, body?.rules ?? []); }
}
