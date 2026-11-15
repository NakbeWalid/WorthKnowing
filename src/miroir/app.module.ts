import { Controller, Get, Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { MarketService } from '../shared/market.service';
import { AdminController } from './admin/admin.controller';
import { BedrockClient } from './ai/bedrock.client';
import { AuthController } from './auth/auth.controller';
import { AdminGuard, AuthGuard } from './auth/auth.guard';
import { AuthService, LocalAuthService } from './auth/auth.service';
import { CognitoAuthService } from './auth/cognito-auth.service';
import { config } from './config';
import { EvaluationController } from './evaluation/evaluation.controller';
import { EvaluationService } from './evaluation/evaluation.service';
import { BedrockNewsProvider } from './news/bedrock-news.provider';
import { GdeltClient } from './news/gdelt.client';
import { NewsCache } from './news/news-cache';
import { MockNewsProvider, NewsProvider } from './news/news.provider';
import { LinkController } from './partner/link.controller';
import { LinkService } from './partner/link.service';
import { PartnerController } from './partner/partner.controller';
import { PartnerGuard, PersonaGuard } from './partner/partner.guard';
import { EventsService } from './realtime/events.service';
import { DynamoStore } from './storage/dynamo.store';
import { JsonStore, Store } from './storage/store';
import { BehaviorAgent } from './trades/agents/behavior.agent';
import { BedrockExplainer, Explainer, TemplateExplainer } from './trades/agents/explainer';
import { GovernanceAgent } from './trades/agents/governance.agent';
import { BedrockInfluenceAgent, InfluenceAgent, NoInfluenceAgent } from './trades/agents/influence.agent';
import { TradesController } from './trades/trades.controller';
import { TradesService } from './trades/trades.service';

/** Sonde de santé pour l'équilibreur de charge (ne dépend d'aucun service externe). */
@Controller('api/health')
class HealthController {
  @Get()
  health() { return { app: 'miroir', ok: true }; }
}

/**
 * Miroir — le service de profil comportemental.
 *   navigateur  : /api/auth, /api/evaluation, /api/link, /api/trades (lecture), /api/admin
 *   partenaire  : /api/partner/v1 (clé d'API + code persona) — seule entrée des trades
 */
@Module({
  imports: [ServeStaticModule.forRoot({ rootPath: join(process.cwd(), 'public', 'miroir'), exclude: ['/api/(.*)'] })],
  controllers: [
    HealthController, AuthController, EvaluationController, LinkController, TradesController,
    PartnerController, AdminController,
  ],
  providers: [
    // ▶ Points de branchement AWS, choisis par variable d'environnement (voir README).
    { provide: Store, useClass: config.storageDriver === 'dynamodb' ? DynamoStore : JsonStore },
    { provide: NewsProvider, useClass: config.newsDriver === 'bedrock' ? BedrockNewsProvider : MockNewsProvider },
    { provide: Explainer, useClass: config.explainerDriver === 'bedrock' ? BedrockExplainer : TemplateExplainer },
    { provide: InfluenceAgent, useClass: config.influenceDriver === 'bedrock' ? BedrockInfluenceAgent : NoInfluenceAgent },
    { provide: AuthService, useClass: config.authDriver === 'cognito' ? CognitoAuthService : LocalAuthService },
    BedrockClient, GdeltClient, NewsCache,
    AuthGuard, AdminGuard, PartnerGuard, PersonaGuard, EventsService, LinkService,
    MarketService, EvaluationService,
    GovernanceAgent, BehaviorAgent, TradesService,
  ],
})
export class AppModule {}
