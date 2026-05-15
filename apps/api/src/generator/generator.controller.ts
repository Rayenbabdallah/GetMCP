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
import { GeneratorService } from './generator.service';
import { ClassifierService } from './classifier.service';
import { CurrentOrg, AuthContext } from '../auth/current-org.decorator';
import { ClassifyDto, GenerateDto, OverrideDto } from './generator.dto';

@Controller('generator')
export class GeneratorController {
  constructor(
    private readonly generatorService: GeneratorService,
    private readonly classifier: ClassifierService,
  ) {}

  @Post('classify')
  async classify(@CurrentOrg() org: AuthContext, @Body() body: ClassifyDto) {
    try {
      const spec = await this.generatorService.fetchSpec(body.openapiUrl);
      return await this.classifier.classify(org.organizationId, spec);
    } catch (err: any) {
      throw new HttpException(err.message || 'classification failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('override')
  async override(@CurrentOrg() org: AuthContext, @Body() body: OverrideDto) {
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
  async generateMcp(@CurrentOrg() org: AuthContext, @Body() request: GenerateDto) {
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
