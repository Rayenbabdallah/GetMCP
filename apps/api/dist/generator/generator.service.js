"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var GeneratorService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeneratorService = exports.GenerationRequestDto = void 0;
const common_1 = require("@nestjs/common");
const axios_1 = __importDefault(require("axios"));
class GenerationRequestDto {
    openapiUrl;
    authProvider;
}
exports.GenerationRequestDto = GenerationRequestDto;
let GeneratorService = GeneratorService_1 = class GeneratorService {
    logger = new common_1.Logger(GeneratorService_1.name);
    async generateTrustBoundaries(req) {
        this.logger.log(`Fetching OpenAPI spec from: ${req.openapiUrl}`);
        let spec;
        try {
            const response = await axios_1.default.get(req.openapiUrl);
            spec = response.data;
        }
        catch (error) {
            this.logger.error(`Failed to fetch OpenAPI spec: ${error.message}`);
            throw new Error(`Could not fetch OpenAPI spec from ${req.openapiUrl}. Please verify the URL.`);
        }
        if (!spec || !spec.paths) {
            throw new Error('Invalid OpenAPI spec provided. Missing paths.');
        }
        const internalMcp = JSON.parse(JSON.stringify(spec));
        const externalMcp = JSON.parse(JSON.stringify(spec));
        externalMcp.paths = {};
        let internalCount = 0;
        let externalCount = 0;
        const sensitivePathKeywords = ['admin', 'internal', 'billing', 'sudo', 'logs', 'metrics', 'webhook', 'system', 'config'];
        const dangerousVerbs = ['delete', 'patch'];
        const piiKeywords = ['ssn', 'password', 'credit_card', 'card_number', 'social_security', 'secret', 'token'];
        const containsKeyword = (text, keywords) => {
            if (!text)
                return false;
            const normalized = text.toLowerCase();
            return keywords.some(k => normalized.includes(k));
        };
        const hasPiiParameters = (parameters) => {
            if (!parameters || !Array.isArray(parameters))
                return false;
            return parameters.some(param => containsKeyword(param.name, piiKeywords) || containsKeyword(param.description, piiKeywords));
        };
        for (const [path, methods] of Object.entries(spec.paths)) {
            internalCount += Object.keys(methods).length;
            const isSensitivePath = containsKeyword(path, sensitivePathKeywords);
            if (!isSensitivePath) {
                const safeMethods = {};
                for (const [verb, details] of Object.entries(methods)) {
                    let isSafe = true;
                    let exclusionReason = '';
                    if (dangerousVerbs.includes(verb.toLowerCase())) {
                        isSafe = false;
                        exclusionReason = 'Dangerous HTTP Verb';
                    }
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
                    if (isSafe && details.parameters && hasPiiParameters(details.parameters)) {
                        isSafe = false;
                        exclusionReason = 'Exposes or requires PII';
                    }
                    if (isSafe && (verb.toLowerCase() === 'post' || verb.toLowerCase() === 'put')) {
                        const hasTenantScope = details.parameters?.some((p) => p.name.toLowerCase().includes('tenant') ||
                            p.name.toLowerCase().includes('user_id') ||
                            p.name.toLowerCase().includes('customer'));
                        if (!hasTenantScope && !path.includes('{')) {
                            isSafe = false;
                            exclusionReason = 'Global mutation lacking tenant isolation';
                        }
                    }
                    if (isSafe) {
                        safeMethods[verb] = details;
                        externalCount++;
                    }
                    else {
                        this.logger.debug(`Excluded [${verb.toUpperCase()}] ${path} from External MCP. Reason: ${exclusionReason}`);
                    }
                }
                if (Object.keys(safeMethods).length > 0) {
                    externalMcp.paths[path] = safeMethods;
                }
            }
            else {
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
    async exportInfrastructureZip(openapiUrl, res) {
        const { internalMcp, externalMcp } = await this.generateTrustBoundaries({ openapiUrl, authProvider: 'Okta' });
        const archiver = require('archiver');
        const archive = archiver('zip', { zlib: { level: 9 } });
        res.set({
            'Content-Type': 'application/zip',
            'Content-Disposition': 'attachment; filename="getmcp-infrastructure.zip"',
        });
        archive.pipe(res);
        const generateServerCode = (name, isInternal) => `
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
        const packageJson = (name) => JSON.stringify({
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
        archive.append(JSON.stringify(internalMcp, null, 2), { name: 'internal-mcp/schema.json' });
        archive.append(packageJson('internal-mcp-server'), { name: 'internal-mcp/package.json' });
        archive.append(generateServerCode('Internal-MCP-Server', true), { name: 'internal-mcp/index.js' });
        archive.append(JSON.stringify(externalMcp, null, 2), { name: 'external-mcp/schema.json' });
        archive.append(packageJson('external-mcp-server'), { name: 'external-mcp/package.json' });
        archive.append(generateServerCode('External-MCP-Server', false), { name: 'external-mcp/index.js' });
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
};
exports.GeneratorService = GeneratorService;
exports.GeneratorService = GeneratorService = GeneratorService_1 = __decorate([
    (0, common_1.Injectable)()
], GeneratorService);
//# sourceMappingURL=generator.service.js.map