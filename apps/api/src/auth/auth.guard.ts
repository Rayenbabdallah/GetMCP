import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma.service';
import { extractPrefix, verifyApiKey } from './api-key.util';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice(7).trim();
    if (!token) throw new UnauthorizedException('Empty bearer token');

    const prefix = extractPrefix(token);
    const candidates = await this.prisma.apiKey.findMany({
      where: { prefix, revokedAt: null },
    });

    for (const candidate of candidates) {
      if (await verifyApiKey(token, candidate.hash)) {
        // best-effort lastUsedAt update; do not block the request on failure
        this.prisma.apiKey
          .update({ where: { id: candidate.id }, data: { lastUsedAt: new Date() } })
          .catch(() => undefined);

        req.auth = {
          organizationId: candidate.organizationId,
          apiKeyId: candidate.id,
        };
        return true;
      }
    }

    throw new UnauthorizedException('Invalid API key');
  }
}
