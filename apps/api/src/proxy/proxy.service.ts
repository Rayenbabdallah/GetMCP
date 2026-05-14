import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export interface AgentRequest {
  method: string;
  path: string;
  source: 'internal_mcp' | 'external_mcp';
  tenantId?: string;
  headers?: Record<string, string>;
  body?: any;
  organizationId?: string;
}

export interface ProxyResponse {
  allowed: boolean;
  status: 'EXECUTED' | 'BLOCKED' | 'AWAITING_APPROVAL';
  reason?: string;
  data?: any;
}

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);

  constructor(private readonly prisma: PrismaService) {}

  async interceptAndExecute(req: AgentRequest): Promise<ProxyResponse> {
    const { method, path, source, headers, tenantId, organizationId } = req;
    if (!organizationId) {
      throw new HttpException(
        { allowed: false, status: 'BLOCKED', reason: 'Missing organization context' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    this.logger.log(`Intercepting [${method}] ${path} from ${source} (org=${organizationId})`);

    const startTime = process.hrtime();

    const activeRules = await this.prisma.policyRule.findMany({
      where: { organizationId, isActive: true },
    });

    for (const rule of activeRules) {
      // Check if this rule applies to the current request
      const methodMatches = rule.targetMethod === '*' || rule.targetMethod.toUpperCase() === method.toUpperCase();
      // Simple path matching for MVP. Could be regex in future.
      const pathMatches = rule.targetPath === '*' || path.includes(rule.targetPath);
      
      // External MCP is usually the target of these policies
      if (source === 'external_mcp' && methodMatches && pathMatches) {
        
        switch (rule.ruleType) {
          case 'AUDIT':
            if (!headers || !headers['x-agent-reasoning']) {
              this.logger.warn(`Blocked by Rule [${rule.name}] - Missing Audit Context`);
              throw new HttpException({
                allowed: false,
                status: 'BLOCKED',
                reason: `Policy Violation: ${rule.description}`
              }, HttpStatus.FORBIDDEN);
            }
            break;

          case 'MUTATION_APPROVAL':
            this.logger.warn(`Intercepted by Rule [${rule.name}] - Triggering Approval`);
            
            const config = rule.actionConfig as any;
            this.dispatchApprovalWebhook(config?.channel || '#ops', req);

            return {
              allowed: false,
              status: 'AWAITING_APPROVAL',
              reason: `Policy Engine intercepted execution: ${rule.description}`
            };

          case 'RATE_LIMIT':
            if (!tenantId) {
              this.logger.error(`Blocked by Rule [${rule.name}] - Missing Tenant Isolation`);
              throw new HttpException({
                allowed: false,
                status: 'BLOCKED',
                reason: `Policy Violation: ${rule.description}`
              }, HttpStatus.FORBIDDEN);
            }
            break;
        }
      }
    }

    // Simulate proxying to the actual downstream enterprise API
    const executionData = await this.simulateDownstreamExecution(req);

    const diff = process.hrtime(startTime);
    const latencyMs = (diff[0] * 1e9 + diff[1]) / 1e6;
    this.logger.log(`Policy Evaluation & Execution cleared in ${latencyMs.toFixed(2)}ms`);

    return {
      allowed: true,
      status: 'EXECUTED',
      data: executionData
    };
  }

  private dispatchApprovalWebhook(channel: string, req: AgentRequest) {
    this.logger.log(`[WEBHOOK] Sending interactive approval card to Slack ${channel} for Agent requesting ${req.path}`);
  }

  private async simulateDownstreamExecution(req: AgentRequest) {
    // This is where GetMCP actually proxies the request to Stripe, Salesforce, etc.
    return {
      success: true,
      message: `Proxied request to internal network safely.`,
      simulated_response: { id: "res_12345", status: "ok" }
    };
  }
}
