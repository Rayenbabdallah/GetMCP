import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class MintApiKeyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;
}
