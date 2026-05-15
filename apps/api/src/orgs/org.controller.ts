import { Body, Controller, Get, Patch, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CurrentOrg, AuthContext } from '../auth/current-org.decorator';
import { encryptSecret } from '../crypto.util';

interface UpdateOrgDto {
  name?: string;
  upstreamBaseUrl?: string | null;
  // Plaintext header value (e.g. "Bearer sk_test_..."). Encrypted at rest.
  // Pass null to clear.
  upstreamAuthHeader?: string | null;
  upstreamTimeoutMs?: number;
}

@Controller('orgs')
export class OrgController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  async me(@CurrentOrg() ctx: AuthContext) {
    const org = await this.prisma.organization.findUnique({
      where: { id: ctx.organizationId },
      select: {
        id: true,
        name: true,
        authType: true,
        upstreamBaseUrl: true,
        upstreamTimeoutMs: true,
        createdAt: true,
        updatedAt: true,
        // upstreamAuthHeader intentionally omitted — never returned in plaintext or ciphertext.
      },
    });
    return { ...org, hasUpstreamAuthHeader: await this.hasAuthHeader(ctx.organizationId) };
  }

  @Patch('me')
  async update(@CurrentOrg() ctx: AuthContext, @Body() body: UpdateOrgDto) {
    const data: Record<string, any> = {};

    if (body.name !== undefined) data.name = body.name;

    if (body.upstreamBaseUrl !== undefined) {
      if (body.upstreamBaseUrl !== null) {
        try {
          const u = new URL(body.upstreamBaseUrl);
          if (!['http:', 'https:'].includes(u.protocol)) {
            throw new Error('only http/https supported');
          }
        } catch {
          throw new BadRequestException('upstreamBaseUrl must be a valid http/https URL');
        }
      }
      data.upstreamBaseUrl = body.upstreamBaseUrl;
    }

    if (body.upstreamAuthHeader !== undefined) {
      data.upstreamAuthHeader =
        body.upstreamAuthHeader === null ? null : encryptSecret(body.upstreamAuthHeader);
    }

    if (body.upstreamTimeoutMs !== undefined) {
      if (!Number.isInteger(body.upstreamTimeoutMs) || body.upstreamTimeoutMs < 100 || body.upstreamTimeoutMs > 120000) {
        throw new BadRequestException('upstreamTimeoutMs must be an integer between 100 and 120000');
      }
      data.upstreamTimeoutMs = body.upstreamTimeoutMs;
    }

    await this.prisma.organization.update({ where: { id: ctx.organizationId }, data });
    return this.me(ctx);
  }

  private async hasAuthHeader(orgId: string): Promise<boolean> {
    const row = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { upstreamAuthHeader: true },
    });
    return Boolean(row?.upstreamAuthHeader);
  }
}
