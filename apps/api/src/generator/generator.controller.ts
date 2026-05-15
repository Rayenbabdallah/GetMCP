import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { GeneratorService, GenerationRequestDto } from './generator.service';
import { ClassifierService } from './classifier.service';
import { CurrentOrg, AuthContext } from '../auth/current-org.decorator';

interface OverrideDto {
  specHash: string;
  path: string;
  method: string;
  exposeExternally: boolean | null;
  reason?: string;
}

@Controller('generator')
export class GeneratorController {
  constructor(
    private readonly generatorService: GeneratorService,
    private readonly classifier: ClassifierService,
  ) {}

  @Post('classify')
  async classify(@CurrentOrg() org: AuthContext, @Body('openapiUrl') openapiUrl: string) {
    if (!openapiUrl) throw new HttpException('openapiUrl is required', HttpStatus.BAD_REQUEST);
    try {
      const spec = await this.generatorService.fetchSpec(openapiUrl);
      return await this.classifier.classify(org.organizationId, spec);
    } catch (err: any) {
      throw new HttpException(err.message || 'classification failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('override')
  async override(@CurrentOrg() org: AuthContext, @Body() body: OverrideDto) {
    if (!body.specHash || !body.path || !body.method) {
      throw new HttpException('specHash, path, method required', HttpStatus.BAD_REQUEST);
    }
    if (body.exposeExternally !== null && typeof body.exposeExternally !== 'boolean') {
      throw new HttpException('exposeExternally must be boolean or null', HttpStatus.BAD_REQUEST);
    }
    try {
      return await this.classifier.setOverride({
        organizationId: org.organizationId,
        apiKeyId: org.apiKeyId,
        specHash: body.specHash,
        path: body.path,
        method: body.method.toLowerCase(),
        exposeExternally: body.exposeExternally,
        reason: body.reason,
      });
    } catch (err: any) {
      throw new HttpException(err.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Post('generate')
  async generateMcp(@CurrentOrg() org: AuthContext, @Body() request: GenerationRequestDto) {
    if (!request.openapiUrl) {
      throw new HttpException('openapiUrl is required', HttpStatus.BAD_REQUEST);
    }
    try {
      return await this.generatorService.generateTrustBoundaries(org.organizationId, request);
    } catch (err: any) {
      throw new HttpException(err.message || 'generation failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('export')
  async exportMcp(
    @CurrentOrg() org: AuthContext,
    @Query('openapiUrl') openapiUrl: string,
    @Res() res: Response,
  ) {
    if (!openapiUrl) throw new HttpException('openapiUrl is required', HttpStatus.BAD_REQUEST);
    try {
      await this.generatorService.exportInfrastructureZip(org.organizationId, openapiUrl, res);
    } catch (err: any) {
      throw new HttpException(err.message || 'export failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
