"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProxyController = void 0;
const common_1 = require("@nestjs/common");
const proxy_service_1 = require("./proxy.service");
let ProxyController = class ProxyController {
    proxyService;
    constructor(proxyService) {
        this.proxyService = proxyService;
    }
    async executeAgentAction(body, sourceHeader, reasoningHeader, tenantHeader) {
        const req = {
            method: body.method || 'GET',
            path: body.path,
            source: sourceHeader || 'external_mcp',
            tenantId: tenantHeader,
            headers: {
                'x-agent-reasoning': reasoningHeader
            },
            body: body.payload
        };
        return await this.proxyService.interceptAndExecute(req);
    }
};
exports.ProxyController = ProxyController;
__decorate([
    (0, common_1.Post)('execute'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Headers)('x-agent-source')),
    __param(2, (0, common_1.Headers)('x-agent-reasoning')),
    __param(3, (0, common_1.Headers)('x-tenant-id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", Promise)
], ProxyController.prototype, "executeAgentAction", null);
exports.ProxyController = ProxyController = __decorate([
    (0, common_1.Controller)('proxy'),
    __metadata("design:paramtypes", [proxy_service_1.ProxyService])
], ProxyController);
//# sourceMappingURL=proxy.controller.js.map