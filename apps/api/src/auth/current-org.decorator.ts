import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';

export class AuthContext {
  organizationId!: string;
  apiKeyId!: string;
}

export const CurrentOrg = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const req = ctx.switchToHttp().getRequest();
    if (!req.auth) {
      throw new UnauthorizedException('No auth context on request');
    }
    return req.auth as AuthContext;
  },
);
