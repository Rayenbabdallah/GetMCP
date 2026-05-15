import { Body, Controller, Get, Patch, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CurrentOrg, AuthContext } from '../auth/current-org.decorator';
import { encryptSecret } from '../crypto.util';

interface UpdateOrgDto {
  name?: string;
  upstreamBaseUrl?: string | null;
  upstreamAuthHeader?: string | null;
  upstreamTimeoutMs?: number;
  // Slack — encrypted at rest. Pass null to clear.
  slackBotToken?: string | null;
  slackSigningSecret?: string | null;
  slackDefaultChannel?: string | null;
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
        slackDefaultChannel: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const flags = await this.prisma.organization.findUnique({
      where: { id: ctx.organizationId },
      select: { upstreamAuthHeader: true, slackBotToken: true, slackSigningSecret: true },
    });
    return {
      ...org,
      hasUpstreamAuthHeader: Boolean(flags?.upstreamAuthHeader),
      hasSlackBotToken: Boolean(flags?.slackBotToken),
      hasSlackSigningSecret: Boolean(flags?.slackSigningSecret),
    };
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

    if (body.slackBotToken !== undefined) {
      data.slackBotToken = body.slackBotToken === null ? null : encryptSecret(body.slackBotToken);
    }
    if (body.slackSigningSecret !== undefined) {
      data.slackSigningSecret =
        body.slackSigningSecret === null ? null : encryptSecret(body.slackSigningSecret);
    }
    if (body.slackDefaultChannel !== undefined) {
      data.slackDefaultChannel = body.slackDefaultChannel;
    }

    await this.prisma.organization.update({ where: { id: ctx.organizationId }, data });
    return this.me(ctx);
  }
}
