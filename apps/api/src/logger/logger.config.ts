import type { Params } from 'nestjs-pino';
import type { IncomingMessage, ServerResponse } from 'http';

// Pino is silent under jest to keep test output legible. Otherwise JSON to stdout
// at info level (override with LOG_LEVEL env var).
function level(): string {
  if (process.env.LOG_LEVEL) return process.env.LOG_LEVEL;
  if (process.env.NODE_ENV === 'test') return 'silent';
  return 'info';
}

export const loggerConfig: Params = {
  pinoHttp: {
    level: level(),
    // pino-http picks up req.id from our RequestIdMiddleware (header x-request-id).
    genReqId: (req: IncomingMessage) =>
      (req.headers['x-request-id'] as string) || (req as any).requestId,
    customProps: (req: IncomingMessage) => {
      const auth = (req as any).auth;
      return auth
        ? { organizationId: auth.organizationId, apiKeyId: auth.apiKeyId }
        : {};
    },
    // Lean serializers — drop verbose fields we don't need in line-per-request logs.
    serializers: {
      req: (req: any) => ({
        id: req.id,
        method: req.method,
        url: req.url,
        remoteAddress: req.remoteAddress,
      }),
      res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
    },
    // Map default log levels by HTTP status; treat 5xx as error.
    customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  },
};
