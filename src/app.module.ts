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
import { MockNewsProvider, NewsProvider } from './news/news.provider';
import { EventsService } from './realtime/events.service';
import { JsonStore, Store } from './storage/store';
import { BehaviorAgent } from './trades/agents/behavior.agent';
import { Explainer, TemplateExplainer } from './trades/agents/explainer';
import { GovernanceAgent } from './trades/agents/governance.agent';
import { TradesController } from './trades/trades.controller';
import { TradesService } from './trades/trades.service';

@Module({
  imports: [ServeStaticModule.forRoot({ rootPath: join(process.cwd(), 'public'), exclude: ['/api/(.*)'] })],
  controllers: [AuthController, EvaluationController, MarketController, TradesController, AdminController],
  providers: [
    // ▶ Les 3 lignes ci-dessous sont les points de branchement AWS (voir KIRO_HANDOFF.md).
    { provide: Store, useClass: JsonStore },               // -> DynamoStore (DynamoDB)
    { provide: NewsProvider, useClass: MockNewsProvider }, // -> BedrockNewsProvider (agent Bedrock)
    { provide: Explainer, useClass: TemplateExplainer },   // -> BedrockExplainer (Bedrock)
    AuthService, AuthGuard, AdminGuard, EventsService,
    MarketService, EvaluationService,
    GovernanceAgent, BehaviorAgent, TradesService,
  ],
})
export class AppModule {}
