import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GeneratorModule } from './generator/generator.module';
import { ProxyModule } from './proxy/proxy.module';
import { OrgModule } from './orgs/org.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health.controller';
import { RequestIdMiddleware } from './request-id.middleware';

@Module({
  imports: [AuthModule, GeneratorModule, ProxyModule, OrgModule],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
