import { Controller, Post, Body, HttpException, HttpStatus, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { GeneratorService, GenerationRequestDto } from './generator.service';

@Controller('generator')
export class GeneratorController {
  constructor(private readonly generatorService: GeneratorService) {}

  @Post('generate')
  async generateMcp(@Body() request: GenerationRequestDto) {
    try {
      if (!request.openapiUrl) {
        throw new HttpException('OpenAPI URL is required', HttpStatus.BAD_REQUEST);
      }
      return await this.generatorService.generateTrustBoundaries(request);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to generate MCP infrastructure',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('export')
  async exportMcp(@Query('openapiUrl') openapiUrl: string, @Res() res: Response) {
    try {
      if (!openapiUrl) {
        throw new HttpException('OpenAPI URL is required', HttpStatus.BAD_REQUEST);
      }
      await this.generatorService.exportInfrastructureZip(openapiUrl, res);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to export MCP infrastructure',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
