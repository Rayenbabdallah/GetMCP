import { Global, Module } from '@nestjs/common';
import { PolicyService } from './policy.service';
import { PolicyController } from './policy.controller';
import { RateLimiter } from './rate-limiter';
import { BehavioralBaselineService } from './baseline.service';

@Global()
@Module({
  controllers: [PolicyController],
  providers: [PolicyService, RateLimiter, BehavioralBaselineService],
  exports: [PolicyService, RateLimiter, BehavioralBaselineService],
})
export class PolicyModule {}
