import { IsBoolean, IsIn, IsOptional, IsString, IsUrl, MaxLength, ValidateIf } from 'class-validator';

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const;

export class ClassifyDto {
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  @MaxLength(2048)
  openapiUrl!: string;
}

export class GenerateDto {
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  @MaxLength(2048)
  openapiUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  authProvider?: string;
}

export class OverrideDto {
  @IsString()
  @MaxLength(64)
  specHash!: string;

  @IsString()
  @MaxLength(2048)
  path!: string;

  @IsString()
  @IsIn(METHODS as unknown as string[])
  method!: typeof METHODS[number];

  @ValidateIf((_, v) => v !== null)
  @IsBoolean()
  exposeExternally!: boolean | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
