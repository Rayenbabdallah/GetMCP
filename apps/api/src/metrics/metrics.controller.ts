import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { MetricsService } from './metrics.service';

@Controller('metrics')
@Public()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  // Public so a Prometheus scraper can hit it without bearer auth. Lock down
  // via network-level controls (in-cluster only, IP allowlist, etc.).
  @Get()
  async render(@Res() res: Response) {
    const { contentType, body } = await this.metrics.render();
    res.setHeader('Content-Type', contentType);
    res.send(body);
  }
}
