"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var ProxyService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProxyService = void 0;
const common_1 = require("@nestjs/common");
let ProxyService = ProxyService_1 = class ProxyService {
    logger = new common_1.Logger(ProxyService_1.name);
    async interceptAndExecute(req) {
        const { method, path, source, headers, tenantId } = req;
        this.logger.log(`Intercepting [${method}] ${path} from ${source}`);
        const startTime = process.hrtime();
        if (source === 'external_mcp' && (!headers || !headers['x-agent-reasoning'])) {
            this.logger.warn(`Blocked [${method}] ${path} - Missing Audit Context`);
            throw new common_1.HttpException({
                allowed: false,
                status: 'BLOCKED',
                reason: 'Policy Violation: Missing x-agent-reasoning header required for audit trail.'
            }, common_1.HttpStatus.FORBIDDEN);
        }
        if (source === 'external_mcp' && method.toUpperCase() === 'POST' && path.includes('/refunds')) {
            this.logger.warn(`Intercepted [${method}] ${path} - Triggering Slack Approval`);
            this.dispatchApprovalWebhook('#finance-ops', req);
            return {
                allowed: false,
                status: 'AWAITING_APPROVAL',
                reason: 'Policy Engine intercepted execution. Awaiting explicit human approval from #finance-ops in Slack.'
            };
        }
        if (source === 'external_mcp' && !tenantId && (method === 'POST' || method === 'PUT')) {
            this.logger.error(`Blocked [${method}] ${path} - Missing Tenant Isolation`);
            throw new common_1.HttpException({
                allowed: false,
                status: 'BLOCKED',
                reason: 'Policy Violation: All mutations from external agents must be scoped with a tenantId.'
            }, common_1.HttpStatus.FORBIDDEN);
        }
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
    dispatchApprovalWebhook(channel, req) {
        this.logger.log(`[WEBHOOK] Sending interactive approval card to Slack ${channel} for Agent requesting ${req.path}`);
    }
    async simulateDownstreamExecution(req) {
        return {
            success: true,
            message: `Proxied request to internal network safely.`,
            simulated_response: { id: "res_12345", status: "ok" }
        };
    }
};
exports.ProxyService = ProxyService;
exports.ProxyService = ProxyService = ProxyService_1 = __decorate([
    (0, common_1.Injectable)()
], ProxyService);
//# sourceMappingURL=proxy.service.js.map