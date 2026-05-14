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
export declare class ProxyService {
    private readonly logger;
    interceptAndExecute(req: AgentRequest): Promise<ProxyResponse>;
    private dispatchApprovalWebhook;
    private simulateDownstreamExecution;
}
