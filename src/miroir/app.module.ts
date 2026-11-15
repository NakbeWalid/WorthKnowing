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
import { IntegrationController } from './integration/integration.controller';
import { IntegrationGuard } from './integration/integration.guard';
import { BedrockNewsProvider } from './news/bedrock-news.provider';
import { GdeltClient } from './news/gdelt.client';
import { NewsCache } from './news/news-cache';
import { MockNewsProvider, NewsProvider } from './news/news.provider';
import { ParserController } from './parser/parser.controller';
import { CvParserService } from './parser/cv-parser.service';
import { LinkController } from './partner/link.controller';
import { LinkService } from './partner/link.service';
import { PartnerController } from './partner/partner.controller';
import { PartnerGuard, PersonaGuard } from './partner/partner.guard';
import { EventsService } from './realtime/events.service';
import { RulesController } from './rules/rules.controller';
import { RulesService } from './rules/rules.service';
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
  health() { return { app: 'worthknowing', ok: true }; }
}

/**
 * WorthKnowing — le service de profil comportemental.
 *   navigateur  : /api/auth, /api/evaluation, /api/rules, /api/parser, /api/link, /api/trades (lecture), /api/admin
 *   partenaire  : /api/partner/v1 (clé d'API + code persona) — seule entrée des trades
 *   intégration : /api/integration/v1 (token d'intégration bancaire direct)
 */
@Module({
  imports: [ServeStaticModule.forRoot({ rootPath: join(process.cwd(), 'public', 'miroir'), exclude: ['/api/(.*)'] })],
  controllers: [
    HealthController, AuthController, EvaluationController, LinkController, TradesController,
    PartnerController, AdminController, RulesController, ParserController, IntegrationController,
  ],
  providers: [
    // ▶ Points de branchement AWS, choisis par variable d'environnement (voir README).
    { provide: Store, useClass: config.storageDriver === 'dynamodb' ? DynamoStore : JsonStore },
    { provide: NewsProvider, useClass: config.newsDriver === 'bedrock' ? BedrockNewsProvider : MockNewsProvider },
    { provide: Explainer, useClass: config.explainerDriver === 'bedrock' ? BedrockExplainer : TemplateExplainer },
    { provide: InfluenceAgent, useClass: config.influenceDriver === 'bedrock' ? BedrockInfluenceAgent : NoInfluenceAgent },
    { provide: AuthService, useClass: config.authDriver === 'cognito' ? CognitoAuthService : LocalAuthService },
    BedrockClient, GdeltClient, NewsCache,
    AuthGuard, AdminGuard, PartnerGuard, PersonaGuard, IntegrationGuard, EventsService, LinkService,
    MarketService, EvaluationService, RulesService, CvParserService,
    GovernanceAgent, BehaviorAgent, TradesService,
  ],
})
export class AppModule {}
