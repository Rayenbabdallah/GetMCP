import type { Response } from 'express';
import { GeneratorService, GenerationRequestDto } from './generator.service';
export declare class GeneratorController {
    private readonly generatorService;
    constructor(generatorService: GeneratorService);
    generateMcp(request: GenerationRequestDto): Promise<import("./generator.service").GenerationResult>;
    exportMcp(openapiUrl: string, res: Response): Promise<void>;
}
