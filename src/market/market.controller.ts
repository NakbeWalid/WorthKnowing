import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { MarketService } from './market.service';

@Controller('api/market')
@UseGuards(AuthGuard)
export class MarketController {
  constructor(private market: MarketService) {}

  @Get('assets')
  assets() {
    return { lastDate: this.market.lastDate, assets: this.market.listAssets() };
  }

  @Get('context')
  context(@Query('ticker') ticker: string, @Query('date') date: string) {
    return this.market.context(ticker, date || this.market.lastDate);
  }
}
