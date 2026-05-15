import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const RULE_TYPES = ['ALLOWLIST', 'BLOCK', 'AUDIT', 'RATE_LIMIT', 'MUTATION_APPROVAL'] as const;
const SOURCES = ['internal_mcp', 'external_mcp'] as const;

export class CreatePolicyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsString()
  @MaxLength(2000)
  description!: string;

  @IsIn(RULE_TYPES as unknown as string[])
  ruleType!: typeof RULE_TYPES[number];

  @IsString()
  @MaxLength(20)
  targetMethod!: string;

  @IsString()
  @MaxLength(2048)
  targetPath!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  action?: string;

  @IsOptional()
  @IsObject()
  actionConfig?: Record<string, any>;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePolicyDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(20) targetMethod?: string;
  @IsOptional() @IsString() @MaxLength(2048) targetPath?: string;
  @IsOptional() @IsString() @MaxLength(50) action?: string;
  @IsOptional() @IsObject() actionConfig?: Record<string, any>;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) priority?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class SimulateDto {
  @IsString() @MaxLength(20) method!: string;
  @IsString() @MaxLength(2048) path!: string;
  @IsIn(SOURCES as unknown as string[]) source!: typeof SOURCES[number];
  @IsOptional() @IsString() @MaxLength(200) agentId?: string | null;
  @IsOptional() @IsString() @MaxLength(200) tenantId?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) reasoning?: string | null;
}
