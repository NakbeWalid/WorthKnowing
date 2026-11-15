import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { TradesService } from './trades.service';

/** Côté utilisateur Miroir : consultation seulement. Les trades arrivent par l'API partenaire. */
@Controller('api')
@UseGuards(AuthGuard)
export class TradesController {
  constructor(private trades: TradesService) {}

  /** Historique des trades enquêtés de l'utilisateur connecté (plus récent d'abord). */
  @Get('trades')
  history(@Req() req: any) { return this.trades.history(req.user); }
}
