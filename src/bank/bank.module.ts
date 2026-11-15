import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { MarketService } from '../shared/market.service';
import { BankAuthController, BankAuthGuard, BankAuthService } from './auth';
import { config } from './config';
import { BankHealthController, MiroirController, TradingController } from './controllers';
import { DynamoBankStore } from './dynamo.store';
import { MiroirLinkService } from './miroir-link.service';
import { MiroirClient } from './miroir.client';
import { BankStore, JsonBankStore } from './store';
import { TradingService } from './trading.service';

/**
 * Boréal Courtage — plateforme de courtage fictive (le « client » de Miroir).
 * Ne dépend d'aucun module de Miroir : elle lui parle uniquement par HTTP (miroir.client.ts).
 */
@Module({
  imports: [ServeStaticModule.forRoot({ rootPath: join(process.cwd(), 'public', 'bank'), exclude: ['/api/(.*)'] })],
  controllers: [BankHealthController, BankAuthController, TradingController, MiroirController],
  providers: [
    { provide: BankStore, useClass: config.storageDriver === 'dynamodb' ? DynamoBankStore : JsonBankStore },
    BankAuthService, BankAuthGuard, MarketService, MiroirClient, MiroirLinkService, TradingService,
  ],
})
export class BankModule {}
