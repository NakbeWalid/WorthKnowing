import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { MarketService } from '../shared/market.service';
import { BankAuthController, BankAuthGuard, BankAuthService } from './auth';
import { config } from './config';
import { BankHealthController, MiroirController, PartnerWebhookController, TradingController } from './controllers';
import { DynamoBankStore } from './dynamo.store';
import { EventsService } from './events.service';
import { MiroirLinkService } from './miroir-link.service';
import { MiroirClient } from './miroir.client';
import { BankStore, JsonBankStore } from './store';
import { TradingService } from './trading.service';

/**
 * Boréal Courtage — plateforme de courtage fictive (le « client » de Miroir).
 * Ne dépend d'aucun module de Miroir : elle lui parle uniquement par HTTP (miroir.client.ts).
 */
@Module({
  imports: [ServeStaticModule.forRoot(
    // Système de design commun aux deux applications (polices, couleurs, composants, graphiques).
    { rootPath: join(process.cwd(), 'node_modules', 'chart.js', 'dist'), serveRoot: '/shared/vendor/chartjs', exclude: ['/api/(.*)'] },
    { rootPath: join(process.cwd(), 'public', 'shared'), serveRoot: '/shared', exclude: ['/api/(.*)'] },
    { rootPath: join(process.cwd(), 'public', 'bank'), exclude: ['/api/(.*)'] },
  )],
  controllers: [BankHealthController, BankAuthController, TradingController, MiroirController, PartnerWebhookController],
  providers: [
    { provide: BankStore, useClass: config.storageDriver === 'dynamodb' ? DynamoBankStore : JsonBankStore },
    BankAuthService, BankAuthGuard, MarketService, MiroirClient, MiroirLinkService, TradingService, EventsService,
  ],
})
export class BankModule {}
