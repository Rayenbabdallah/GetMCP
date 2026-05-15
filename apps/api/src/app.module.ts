import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GeneratorModule } from './generator/generator.module';
import { ProxyModule } from './proxy/proxy.module';
import { OrgModule } from './orgs/org.module';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { AgentModule } from './agents/agent.module';
import { PolicyModule } from './policy/policy.module';
import { SlackModule } from './slack/slack.module';
import { ApprovalModule } from './approval/approval.module';
import { MetricsModule } from './metrics/metrics.module';
import { HealthController } from './health.controller';
import { RequestIdMiddleware } from './request-id.middleware';
import { loggerConfig } from './logger/logger.config';

@Module({
  imports: [
    LoggerModule.forRoot(loggerConfig),
    MetricsModule,
    AuthModule,
    AuditModule,
    AgentModule,
    PolicyModule,
    SlackModule,
    ApprovalModule,
    GeneratorModule,
    ProxyModule,
    OrgModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
