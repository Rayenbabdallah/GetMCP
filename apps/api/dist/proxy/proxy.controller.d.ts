import { ProxyService } from './proxy.service';
export declare class ProxyController {
    private readonly proxyService;
    constructor(proxyService: ProxyService);
    executeAgentAction(body: any, sourceHeader: string, reasoningHeader: string, tenantHeader: string): Promise<import("./proxy.service").ProxyResponse>;
}
