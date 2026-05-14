import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';

export interface AgentRequest {
  method: string;
  path: string;
  source: 'internal_mcp' | 'external_mcp';
  tenantId?: string;
  headers?: Record<string, string>;
  body?: any;
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

  // In a real $1B system, these policies are loaded dynamically from a DB or OPA Rego engine.
  // For the MVP, we hardcode the logic representing the rules in the UI.

  async interceptAndExecute(req: AgentRequest): Promise<ProxyResponse> {
    const { method, path, source, headers, tenantId } = req;
    this.logger.log(`Intercepting [${method}] ${path} from ${source}`);

    const startTime = process.hrtime();

    // RULE 1: AUDIT - Mandatory Context Logging
    if (source === 'external_mcp' && (!headers || !headers['x-agent-reasoning'])) {
      this.logger.warn(`Blocked [${method}] ${path} - Missing Audit Context`);
      throw new HttpException({
        allowed: false,
        status: 'BLOCKED',
        reason: 'Policy Violation: Missing x-agent-reasoning header required for audit trail.'
      }, HttpStatus.FORBIDDEN);
    }

    // RULE 2: MUTATION - Require Human Approval for Refunds
    if (source === 'external_mcp' && method.toUpperCase() === 'POST' && path.includes('/refunds')) {
      this.logger.warn(`Intercepted [${method}] ${path} - Triggering Slack Approval`);
      
      // Simulate dispatching a webhook to Slack
      this.dispatchApprovalWebhook('#finance-ops', req);

      return {
        allowed: false,
        status: 'AWAITING_APPROVAL',
        reason: 'Policy Engine intercepted execution. Awaiting explicit human approval from #finance-ops in Slack.'
      };
    }

    // RULE 3: RATE LIMIT & ISOLATION
    if (source === 'external_mcp' && !tenantId && (method === 'POST' || method === 'PUT')) {
       this.logger.error(`Blocked [${method}] ${path} - Missing Tenant Isolation`);
       throw new HttpException({
        allowed: false,
        status: 'BLOCKED',
        reason: 'Policy Violation: All mutations from external agents must be scoped with a tenantId.'
      }, HttpStatus.FORBIDDEN);
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
