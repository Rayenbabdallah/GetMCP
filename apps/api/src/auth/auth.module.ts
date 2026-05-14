import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaService } from '../prisma.service';
import { AuthGuard } from './auth.guard';
import { ApiKeyController } from './api-key.controller';

@Global()
@Module({
  controllers: [ApiKeyController],
  providers: [
    PrismaService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
  exports: [PrismaService],
})
export class AuthModule {}
