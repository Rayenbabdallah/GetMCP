import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
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
  const express = require('express');

  // Capture the raw body on Slack's interaction route so we can verify the
  // HMAC signature byte-for-byte. Slack sends application/x-www-form-urlencoded.
  const rawBodySaver = (req: any, _res: any, buf: Buffer, encoding: string) => {
    if (buf && buf.length) req.rawBody = buf.toString((encoding as BufferEncoding) || 'utf8');
  };
  app.use(
    '/slack/interactions',
    express.urlencoded({ limit, extended: true, verify: rawBodySaver }),
  );

  // Standard parsers for everything else.
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
