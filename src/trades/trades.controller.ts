import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { TradeRequest, TradesService } from './trades.service';

@Controller('api')
@UseGuards(AuthGuard)
export class TradesController {
  constructor(private trades: TradesService) {}

  /** Pré-contrôle : quelles règles personnelles ce trade toucherait-il ? */
  @Post('trades/check')
  check(@Req() req: any, @Body() body: TradeRequest) { return this.trades.check(req.user, body); }

  /** Endpoint principal : reçoit le trade simulé et lance le pipeline d'enquête. */
  @Post('trades')
  submit(@Req() req: any, @Body() body: TradeRequest) { return this.trades.submit(req.user, body); }

  @Get('trades')
  history(@Req() req: any) { return this.trades.history(req.user); }

  @Get('portfolio')
  portfolio(@Req() req: any, @Query('date') date?: string) { return this.trades.portfolio(req.user, date || undefined); }
}
