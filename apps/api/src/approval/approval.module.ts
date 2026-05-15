import { Global, Module } from '@nestjs/common';
import { ApprovalService } from './approval.service';
import { ApprovalController } from './approval.controller';
import { ApprovalSweeper } from './approval.sweeper';

@Global()
@Module({
  controllers: [ApprovalController],
  providers: [ApprovalService, ApprovalSweeper],
  exports: [ApprovalService],
})
export class ApprovalModule {}
