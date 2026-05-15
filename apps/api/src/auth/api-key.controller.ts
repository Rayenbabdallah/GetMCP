import { Body, Controller, Delete, Get, Param, Post, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CurrentOrg, AuthContext } from './current-org.decorator';
import { mintApiKey } from './api-key.util';
import { MintApiKeyDto } from './api-key.dto';

@Controller('api-keys')
export class ApiKeyController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@CurrentOrg() org: AuthContext) {
    return this.prisma.apiKey.findMany({
      where: { organizationId: org.organizationId },
      select: {
        id: true,
        name: true,
        prefix: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Returns the plaintext key exactly once. Caller must store it.
  @Post()
  async mint(@CurrentOrg() org: AuthContext, @Body() body: MintApiKeyDto) {
    const minted = await mintApiKey();
    const row = await this.prisma.apiKey.create({
      data: {
        organizationId: org.organizationId,
        name: body.name?.trim() || 'unnamed',
        prefix: minted.prefix,
        hash: minted.hash,
      },
    });
    return { id: row.id, name: row.name, key: minted.plaintext };
  }

  @Delete(':id')
  async revoke(@CurrentOrg() org: AuthContext, @Param('id') id: string) {
    const row = await this.prisma.apiKey.findFirst({
      where: { id, organizationId: org.organizationId },
    });
    if (!row) throw new NotFoundException();
    return this.prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }
}
