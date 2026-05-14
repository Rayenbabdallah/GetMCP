import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: true });
  const logger = new Logger('Bootstrap');

  app.use(helmet());

  const origins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins.length > 0 ? origins : false,
    credentials: true,
  });

  const limit = process.env.JSON_BODY_LIMIT || '1mb';
  // NestJS uses express body parsers under the hood; reset with size limit.
  const express = require('express');
  app.use(express.json({ limit }));
  app.use(express.urlencoded({ limit, extended: true }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`API listening on :${port} (CORS: ${origins.length ? origins.join(', ') : 'disabled'})`);
}
bootstrap();
