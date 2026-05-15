import { Body, Controller, Get, Patch } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CurrentOrg, AuthContext } from '../auth/current-org.decorator';
import { encryptSecret } from '../crypto.util';
import { UpdateOrgDto } from './org.dto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('Organizations')
@ApiBearerAuth('org-api-key')
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
    if (body.upstreamBaseUrl !== undefined) data.upstreamBaseUrl = body.upstreamBaseUrl;
    if (body.upstreamTimeoutMs !== undefined) data.upstreamTimeoutMs = body.upstreamTimeoutMs;

    if (body.upstreamAuthHeader !== undefined) {
      data.upstreamAuthHeader =
        body.upstreamAuthHeader === null ? null : encryptSecret(body.upstreamAuthHeader);
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
