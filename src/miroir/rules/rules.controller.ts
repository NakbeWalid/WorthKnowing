import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { RuleInput, RulesService } from './rules.service';

type RulesBody = { rules?: Partial<RuleInput>[] } & Partial<RuleInput>;

/**
 * Règles personnelles, gérées depuis WorthKnowing : ajouter, modifier, retirer.
 * Les modifier ne touche pas à la dérive : voir RulesService.
 */
@Controller('api/rules')
@UseGuards(AuthGuard)
export class RulesController {
  constructor(private rulesService: RulesService) {}

  /** Règles courantes et règles proposées. */
  @Get()
  getRules(@Req() req: any) { return this.rulesService.getSmartRules(req.user); }

  /** Remplace l'ensemble des règles. */
  @Put()
  saveRules(@Req() req: any, @Body() body: RulesBody) { return this.rulesService.saveRules(req.user, body?.rules ?? []); }

  /** Ajoute une règle : { param, text }. (Avec { rules: [...] } : remplace tout, comme PUT.) */
  @Post()
  addRule(@Req() req: any, @Body() body: RulesBody) {
    return Array.isArray(body?.rules) ? this.rulesService.saveRules(req.user, body.rules) : this.rulesService.addRule(req.user, body);
  }

  /** Modifie le texte (ou le comportement rattaché) d'une règle. */
  @Put(':id')
  updateRule(@Req() req: any, @Param('id') id: string, @Body() body: Partial<RuleInput>) {
    return this.rulesService.updateRule(req.user, id, body);
  }

  @Delete(':id')
  removeRule(@Req() req: any, @Param('id') id: string) { return this.rulesService.removeRule(req.user, id); }
}
