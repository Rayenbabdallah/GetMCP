import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ApprovalService } from './approval.service';

const SWEEP_INTERVAL_MS = 30_000;

@Injectable()
export class ApprovalSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ApprovalSweeper.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly approvals: ApprovalService) {}

  onModuleInit() {
    // Skip the timer in test environments — tests drive expire() directly.
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.approvals
        .sweepExpired()
        .then((n) => n > 0 && this.logger.log(`expired ${n} pending requests`))
        .catch((e) => this.logger.error(`sweep failed: ${e.message}`));
    }, SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
