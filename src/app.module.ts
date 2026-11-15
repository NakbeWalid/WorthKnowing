import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AdminController } from './admin/admin.controller';
import { AuthController } from './auth/auth.controller';
import { AdminGuard, AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { EvaluationController } from './evaluation/evaluation.controller';
import { EvaluationService } from './evaluation/evaluation.service';
import { MarketController } from './market/market.controller';
import { MarketService } from './market/market.service';
import { BedrockClient } from './ai/bedrock.client';
import { config } from './config';
import { BedrockNewsProvider } from './news/bedrock-news.provider';
import { GdeltClient } from './news/gdelt.client';
import { NewsCache } from './news/news-cache';
import { MockNewsProvider, NewsProvider } from './news/news.provider';
import { EventsService } from './realtime/events.service';
import { JsonStore, Store } from './storage/store';
import { BehaviorAgent } from './trades/agents/behavior.agent';
import { BedrockExplainer, Explainer, TemplateExplainer } from './trades/agents/explainer';
import { BedrockInfluenceAgent, InfluenceAgent, NoInfluenceAgent } from './trades/agents/influence.agent';
import { GovernanceAgent } from './trades/agents/governance.agent';
import { TradesController } from './trades/trades.controller';
import { TradesService } from './trades/trades.service';

@Module({
  imports: [ServeStaticModule.forRoot({ rootPath: join(process.cwd(), 'public'), exclude: ['/api/(.*)'] })],
  controllers: [AuthController, EvaluationController, MarketController, TradesController, AdminController],
  providers: [
    // ▶ Points de branchement AWS, choisis par variable d'environnement (voir README).
    { provide: Store, useClass: JsonStore },               // -> DynamoStore (DynamoDB)
    { provide: NewsProvider, useClass: config.newsDriver === 'bedrock' ? BedrockNewsProvider : MockNewsProvider },
    { provide: Explainer, useClass: config.explainerDriver === 'bedrock' ? BedrockExplainer : TemplateExplainer },
    { provide: InfluenceAgent, useClass: config.influenceDriver === 'bedrock' ? BedrockInfluenceAgent : NoInfluenceAgent },
    BedrockClient, GdeltClient, NewsCache,
    AuthService, AuthGuard, AdminGuard, EventsService,
    MarketService, EvaluationService,
    GovernanceAgent, BehaviorAgent, TradesService,
  ],
})
export class AppModule {}
