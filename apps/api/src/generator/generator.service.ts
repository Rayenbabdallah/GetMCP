import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import type { Response } from 'express';

export class GenerationRequestDto {
  openapiUrl: string;
  authProvider: string;
}

export interface McpSchema {
  info: {
    title: string;
    description: string;
    version: string;
  };
  paths: Record<string, any>;
  components?: any;
}

export interface GenerationResult {
  internalMcp: McpSchema;
  externalMcp: McpSchema;
  internalEndpointsCount: number;
  externalEndpointsCount: number;
}

@Injectable()
export class GeneratorService {
  private readonly logger = new Logger(GeneratorService.name);

  async generateTrustBoundaries(req: GenerationRequestDto): Promise<GenerationResult> {
    this.logger.log(`Fetching OpenAPI spec from: ${req.openapiUrl}`);
    
    let spec: McpSchema;
    try {
      const response = await axios.get(req.openapiUrl);
      spec = response.data;
    } catch (error) {
      this.logger.error(`Failed to fetch OpenAPI spec: ${error.message}`);
      throw new Error(`Could not fetch OpenAPI spec from ${req.openapiUrl}. Please verify the URL.`);
    }

    if (!spec || !spec.paths) {
      throw new Error('Invalid OpenAPI spec provided. Missing paths.');
    }

    // The core heuristic engine for the Two-MCP model
    const internalMcp: McpSchema = JSON.parse(JSON.stringify(spec));
    const externalMcp: McpSchema = JSON.parse(JSON.stringify(spec));
    
    externalMcp.paths = {};
    let internalCount = 0;
    let externalCount = 0;

    // Advanced Heuristics Configuration
    const sensitivePathKeywords = ['admin', 'internal', 'billing', 'sudo', 'logs', 'metrics', 'webhook', 'system', 'config'];
    const dangerousVerbs = ['delete', 'patch'];
    const piiKeywords = ['ssn', 'password', 'credit_card', 'card_number', 'social_security', 'secret', 'token'];
    
    // Helper to check if text contains sensitive keywords
    const containsKeyword = (text: string, keywords: string[]) => {
      if (!text) return false;
      const normalized = text.toLowerCase();
      return keywords.some(k => normalized.includes(k));
    };

    // Helper to check for PII in parameters
    const hasPiiParameters = (parameters: any[]) => {
      if (!parameters || !Array.isArray(parameters)) return false;
      return parameters.some(param => containsKeyword(param.name, piiKeywords) || containsKeyword(param.description, piiKeywords));
    };

    for (const [path, methods] of Object.entries(spec.paths)) {
      internalCount += Object.keys(methods).length;
      
      // 1. Path-level heuristic
      const isSensitivePath = containsKeyword(path, sensitivePathKeywords);
      
      if (!isSensitivePath) {
        const safeMethods: Record<string, any> = {};
        
        for (const [verb, details] of Object.entries(methods) as [string, any][]) {
          let isSafe = true;
          let exclusionReason = '';

          // 2. Verb-level heuristic
          if (dangerousVerbs.includes(verb.toLowerCase())) {
            isSafe = false;
            exclusionReason = 'Dangerous HTTP Verb';
          }

          // 3. Metadata heuristic (Tags & Descriptions)
          if (isSafe && details && typeof details === 'object') {
            const description = (details.description || '') + ' ' + (details.summary || '');
            if (containsKeyword(description, sensitivePathKeywords)) {
              isSafe = false;
              exclusionReason = 'Sensitive keywords in description';
            }
            
            if (details.tags && Array.isArray(details.tags) && containsKeyword(details.tags.join(' '), sensitivePathKeywords)) {
              isSafe = false;
              exclusionReason = 'Sensitive tags applied';
            }
          }

          // 4. Data Privacy heuristic (PII Detection)
          if (isSafe && details.parameters && hasPiiParameters(details.parameters)) {
            isSafe = false;
            exclusionReason = 'Exposes or requires PII';
          }

          // 5. Tenant Isolation heuristic (Mutations must be scoped)
          if (isSafe && (verb.toLowerCase() === 'post' || verb.toLowerCase() === 'put')) {
            const hasTenantScope = details.parameters?.some((p: any) => 
              p.name.toLowerCase().includes('tenant') || 
              p.name.toLowerCase().includes('user_id') ||
              p.name.toLowerCase().includes('customer')
            );
            
            // If it's a POST/PUT without a clear tenant/user scope parameter, it's too dangerous for an external agent
            if (!hasTenantScope && !path.includes('{')) {
              isSafe = false;
              exclusionReason = 'Global mutation lacking tenant isolation';
            }
          }

          if (isSafe) {
            safeMethods[verb] = details;
            externalCount++;
          } else {
            this.logger.debug(`Excluded [${verb.toUpperCase()}] ${path} from External MCP. Reason: ${exclusionReason}`);
          }
        }

        if (Object.keys(safeMethods).length > 0) {
          externalMcp.paths[path] = safeMethods;
        }
      } else {
        this.logger.debug(`Excluded all methods for ${path} from External MCP. Reason: Sensitive Path`);
      }
    }

    internalMcp.info.title = `${spec.info?.title || 'API'} - Internal Agent Mode (God Mode)`;
    externalMcp.info.title = `${spec.info?.title || 'API'} - External Agent Mode (Scoped)`;

    return {
      internalMcp,
      externalMcp,
      internalEndpointsCount: internalCount,
      externalEndpointsCount: externalCount,
    };
  }

  async exportInfrastructureZip(openapiUrl: string, res: Response) {
    // 1. Generate the schemas
    const { internalMcp, externalMcp } = await this.generateTrustBoundaries({ openapiUrl, authProvider: 'Okta' });

    // 2. Setup the ZIP archiver
    const archiver = require('archiver');
    const archive = archiver('zip', { zlib: { level: 9 } });

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="getmcp-infrastructure.zip"',
    });

    archive.pipe(res);

    // --- Helper function to generate an MCP Node.js server boilerpalte ---
    const generateServerCode = (name: string, isInternal: boolean) => `
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import schema from "./schema.json" assert { type: "json" };

const server = new Server({
  name: "${name}",
  version: "1.0.0",
}, {
  capabilities: {
    resources: {},
    tools: {},
    prompts: {},
  }
});

// GETMCP Auto-Generated Server
// ${isInternal ? 'WARNING: HIGH PRIVILEGE INTERNAL SERVER' : 'SAFE: SCOPED EXTERNAL SERVER'}

console.error("Starting GetMCP ${name}...");
// Core implementation goes here based on the schema...

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("GetMCP ${name} connected on stdio");
`;

    const packageJson = (name: string) => JSON.stringify({
      name: name,
      version: "1.0.0",
      type: "module",
      main: "index.js",
      dependencies: {
        "@modelcontextprotocol/sdk": "^0.6.0"
      },
      scripts: {
        "start": "node index.js"
      }
    }, null, 2);

    // --- Inject Internal Server Files ---
    archive.append(JSON.stringify(internalMcp, null, 2), { name: 'internal-mcp/schema.json' });
    archive.append(packageJson('internal-mcp-server'), { name: 'internal-mcp/package.json' });
    archive.append(generateServerCode('Internal-MCP-Server', true), { name: 'internal-mcp/index.js' });

    // --- Inject External Server Files ---
    archive.append(JSON.stringify(externalMcp, null, 2), { name: 'external-mcp/schema.json' });
    archive.append(packageJson('external-mcp-server'), { name: 'external-mcp/package.json' });
    archive.append(generateServerCode('External-MCP-Server', false), { name: 'external-mcp/index.js' });

    // --- Inject Docker Compose ---
    const dockerCompose = `
version: '3.8'
services:
  internal-mcp:
    build: ./internal-mcp
    environment:
      - NODE_ENV=production
  external-mcp:
    build: ./external-mcp
    environment:
      - NODE_ENV=production
    `;
    archive.append(dockerCompose, { name: 'docker-compose.yml' });

    await archive.finalize();
  }
}
