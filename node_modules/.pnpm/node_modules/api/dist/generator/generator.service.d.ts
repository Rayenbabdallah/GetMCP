import type { Response } from 'express';
export declare class GenerationRequestDto {
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
export declare class GeneratorService {
    private readonly logger;
    generateTrustBoundaries(req: GenerationRequestDto): Promise<GenerationResult>;
    exportInfrastructureZip(openapiUrl: string, res: Response): Promise<void>;
}
