import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false, bufferLogs: true });
  app.useLogger(app.get(Logger));
  // Drains in-flight requests + closes Prisma + stops sweepers cleanly on SIGINT/SIGTERM.
  app.enableShutdownHooks();

  app.use(helmet());

  // Compression for JSON-heavy responses (audit list, classifications, policies).
  // Skipped for the proxy stream — compression buffers chunked responses, which
  // would defeat the streaming pass-through and inflate p95 on large bodies.
  app.use(
    compression({
      filter: (req, res) => {
        if (req.path.startsWith('/proxy/execute')) return false;
        if (req.path.startsWith('/audit/export')) return false; // already streaming NDJSON
        return compression.filter(req, res);
      },
    }),
  );

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

  // Swagger UI at /docs and machine-readable OpenAPI spec at /docs-json.
  // Disabled by default in production — set ENABLE_DOCS=true to expose.
  // The docs route is unauthenticated; if exposed externally, gate at the
  // ingress (auth header, IP allowlist, or a separate hostname).
  if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_DOCS === 'true') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('GetMCP API')
      .setDescription(
        'Zero Trust for AI agents. Generates and protects MCP servers. ' +
          'See https://github.com/Rayenbabdallah/GetMCP for the full project.',
      )
      .setVersion('0.1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'gmcp_…' },
        'org-api-key',
      )
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  app.get(Logger).log(`API listening on :${port} (CORS: ${origins.length ? origins.join(', ') : 'disabled'})`);
}
bootstrap();
