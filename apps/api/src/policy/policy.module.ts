import { Global, Module } from '@nestjs/common';
import { PolicyService } from './policy.service';
import { PolicyController } from './policy.controller';
import { RateLimiter } from './rate-limiter';

@Global()
@Module({
  controllers: [PolicyController],
  providers: [PolicyService, RateLimiter],
  exports: [PolicyService, RateLimiter],
})
export class PolicyModule {}
