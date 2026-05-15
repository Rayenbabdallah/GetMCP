import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false, bufferLogs: true });
  app.useLogger(app.get(Logger));
  // Drains in-flight requests + closes Prisma + stops sweepers cleanly on SIGINT/SIGTERM.
  app.enableShutdownHooks();

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

  const rawBodySaver = (req: any, _res: any, buf: Buffer, encoding: string) => {
    if (buf && buf.length) req.rawBody = buf.toString((encoding as BufferEncoding) || 'utf8');
  };
  app.use(
    '/slack/interactions',
    express.urlencoded({ limit, extended: true, verify: rawBodySaver }),
  );

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
  app.get(Logger).log(`API listening on :${port} (CORS: ${origins.length ? origins.join(', ') : 'disabled'})`);
}
bootstrap();
