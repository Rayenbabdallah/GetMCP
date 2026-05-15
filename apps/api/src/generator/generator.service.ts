import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import type { Response } from 'express';
import { ClassifierService, ClassifiedEndpoint } from './classifier.service';
import { buildServerScaffold } from './code-gen';

export class GenerationRequestDto {
  openapiUrl!: string;
  authProvider?: string;
}

export interface McpSchema {
  info: { title: string; description?: string; version?: string };
  paths: Record<string, any>;
  components?: any;
}

export interface GenerationResult {
  internalMcp: McpSchema;
  externalMcp: McpSchema;
  internalEndpointsCount: number;
  externalEndpointsCount: number;
  specHash: string;
  classifierSource: 'llm' | 'heuristic';
  cacheHit: boolean;
}

@Injectable()
export class GeneratorService {
  private readonly logger = new Logger(GeneratorService.name);

  constructor(private readonly classifier: ClassifierService) {}

  async fetchSpec(url: string): Promise<McpSchema> {
    this.logger.log(`Fetching OpenAPI spec from: ${url}`);
    const response = await axios.get(url, { timeout: 30_000 });
    const spec = response.data;
    if (!spec || !spec.paths) throw new Error('Invalid OpenAPI spec: missing paths');
    return spec;
  }

  async generateTrustBoundaries(
    organizationId: string,
    req: GenerationRequestDto,
  ): Promise<GenerationResult> {
    const spec = await this.fetchSpec(req.openapiUrl);
    const result = await this.classifier.classify(organizationId, spec);
    return this.buildFromClassifications(spec, result.endpoints, result.specHash, result.source, result.cacheHit);
  }

  buildFromClassifications(
    spec: McpSchema,
    classifications: ClassifiedEndpoint[],
    hash: string,
    source: 'llm' | 'heuristic',
    cacheHit: boolean,
  ): GenerationResult {
    const internalMcp: McpSchema = JSON.parse(JSON.stringify(spec));
    const externalMcp: McpSchema = JSON.parse(JSON.stringify(spec));
    externalMcp.paths = {};

    let internalCount = 0;
    let externalCount = 0;

    const externalKeys = new Set<string>();
    for (const c of classifications) {
      if (this.classifier.effectiveVerdict(c)) {
        externalKeys.add(`${c.method.toLowerCase()} ${c.path}`);
      }
    }

    for (const [path, methods] of Object.entries(spec.paths)) {
      const safeMethods: Record<string, any> = {};
      for (const [verb, op] of Object.entries(methods as object)) {
        internalCount++;
        if (externalKeys.has(`${verb.toLowerCase()} ${path}`)) {
          safeMethods[verb] = op;
          externalCount++;
        }
      }
      if (Object.keys(safeMethods).length > 0) externalMcp.paths[path] = safeMethods;
    }

    internalMcp.info.title = `${spec.info?.title || 'API'} - Internal Agent Mode (God Mode)`;
    externalMcp.info.title = `${spec.info?.title || 'API'} - External Agent Mode (Scoped)`;

    return {
      internalMcp,
      externalMcp,
      internalEndpointsCount: internalCount,
      externalEndpointsCount: externalCount,
      specHash: hash,
      classifierSource: source,
      cacheHit,
    };
  }

  async exportInfrastructureZip(organizationId: string, openapiUrl: string, res: Response) {
    const spec = await this.fetchSpec(openapiUrl);
    const cls = await this.classifier.classify(organizationId, spec);
    const generated = this.buildFromClassifications(spec, cls.endpoints, cls.specHash, cls.source, cls.cacheHit);

    const archiver = require('archiver');
    const archive = archiver('zip', { zlib: { level: 9 } });
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="getmcp-infrastructure.zip"',
    });
    archive.pipe(res);

    const internal = buildServerScaffold('internal-mcp-server', generated.internalMcp, true);
    const external = buildServerScaffold('external-mcp-server', generated.externalMcp, false);
    for (const f of internal.files) archive.append(f.content, { name: `internal-mcp/${f.path}` });
    for (const f of external.files) archive.append(f.content, { name: `external-mcp/${f.path}` });

    archive.append(this.dockerCompose(), { name: 'docker-compose.yml' });
    archive.append(this.rootReadme(generated), { name: 'README.md' });
    await archive.finalize();
  }

  private dockerCompose(): string {
    return `version: '3.8'
services:
  internal-mcp:
    build: ./internal-mcp
    environment:
      - UPSTREAM_BASE_URL=\${INTERNAL_UPSTREAM_BASE_URL}
      - UPSTREAM_AUTH_HEADER=\${INTERNAL_UPSTREAM_AUTH_HEADER}
  external-mcp:
    build: ./external-mcp
    environment:
      - UPSTREAM_BASE_URL=\${EXTERNAL_UPSTREAM_BASE_URL}
      - UPSTREAM_AUTH_HEADER=\${EXTERNAL_UPSTREAM_AUTH_HEADER}
`;
  }

  private rootReadme(g: GenerationResult): string {
    return `# GetMCP-generated MCP servers

Generated from OpenAPI spec (hash \`${g.specHash}\`, classifier: ${g.classifierSource}${g.cacheHit ? ', cached' : ''}).

- **internal-mcp/** — ${g.internalEndpointsCount} tools. Full privilege.
- **external-mcp/** — ${g.externalEndpointsCount} tools. Scoped subset, customer-safe.

See each subfolder's README for run instructions. The recommended deployment routes both servers' \`UPSTREAM_BASE_URL\` through your GetMCP proxy for policy enforcement and audit.
`;
  }
}
