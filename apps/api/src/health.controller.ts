import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Public } from './auth/public.decorator';

@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'up' };
    } catch (err) {
      return { status: 'degraded', db: 'down' };
    }
  }
}
