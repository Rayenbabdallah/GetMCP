import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ProxyService, AgentRequest } from '../proxy/proxy.service';
import { AuditService } from '../audit/audit.service';
import { SlackService } from '../slack/slack.service';
import { decryptSecret } from '../crypto.util';
import { MetricsService } from '../metrics/metrics.service';

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const MAX_BODY_BYTES = 256 * 1024;

export interface CreatePendingInput {
  organizationId: string;
  agentId: string;
  agentName: string;
  apiKeyId: string;
  method: string;
  path: string;
  query?: any;
  body?: any;
  source: 'internal_mcp' | 'external_mcp';
  tenantId?: string | null;
  reasoning?: string | null;
  ruleId: string;
  ruleName: string;
  channel: string;
  ttlMs?: number;
}

export interface DecisionInput {
  pendingId: string;
  approverSlackUserId: string;
  approverSlackUserName: string;
  /** Required when the originating rule has actionConfig.requireJustification === true. */
  justification?: string;
}

export type ApprovalAttemptResult =
  | { kind: 'pending_quorum'; have: number; need: number }
  | { kind: 'already_voted'; have: number; need: number }
  | { kind: 'rejected_missing_justification' }
  | { kind: 'decided'; pending: any };

@Injectable()
export class ApprovalService {
  private readonly logger = new Logger(ApprovalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly proxy: ProxyService,
    private readonly audit: AuditService,
    private readonly slack: SlackService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async createPending(input: CreatePendingInput) {
    const ttl = input.ttlMs ?? DEFAULT_TTL_MS;
    const pending = await this.prisma.pendingRequest.create({
      data: {
        organizationId: input.organizationId,
        agentId: input.agentId,
        apiKeyId: input.apiKeyId,
        method: input.method,
        path: input.path,
        query: input.query ?? null,
        body: input.body ?? null,
        source: input.source,
        tenantId: input.tenantId ?? null,
        reasoning: input.reasoning ?? null,
        ruleId: input.ruleId,
        ruleName: input.ruleName,
        channel: input.channel,
        expiresAt: new Date(Date.now() + ttl),
      },
    });

    // Best-effort Slack post; if it fails we still keep the pending row so the
    // approval can be made via a future admin channel (e.g. dashboard).
    try {
      const org = await this.prisma.organization.findUnique({
        where: { id: input.organizationId },
        select: { slackBotToken: true },
      });
      if (org?.slackBotToken) {
        const token = decryptSecret(org.slackBotToken);
        const rule = await this.prisma.policyRule.findFirst({
          where: { id: input.ruleId, organizationId: input.organizationId },
          select: { actionConfig: true },
        });
        const cfg = (rule?.actionConfig as any) ?? {};
        const ref = await this.slack.postApprovalMessage(token, input.channel, {
          pendingId: pending.id,
          agentName: input.agentName,
          source: input.source,
          tenantId: input.tenantId ?? null,
          method: input.method,
          path: input.path,
          reasoning: input.reasoning ?? null,
          ruleName: input.ruleName,
          expiresAt: pending.expiresAt,
          requireJustification: Boolean(cfg.requireJustification),
          quorumRequired: Number.isInteger(cfg.quorumRequired) && cfg.quorumRequired > 0 ? cfg.quorumRequired : 1,
          quorumHave: 0,
        });
        await this.prisma.pendingRequest.update({
          where: { id: pending.id },
          data: { slackMessageTs: ref.ts, channel: ref.channel },
        });
      } else {
        this.logger.warn(
          `Org ${input.organizationId} has no slackBotToken; pending ${pending.id} created without Slack notification`,
        );
      }
    } catch (err: any) {
      this.logger.error(`Slack post failed for pending ${pending.id}: ${err.message}`);
    }

    this.metrics?.recordApproval('created');
    return pending;
  }

  // Records a vote and, if quorum is reached, runs the full replay flow.
  // Returns one of:
  //   - { kind: 'rejected_missing_justification' } — rule requires justification, none provided
  //   - { kind: 'already_voted', ... }              — this user already voted on this pending
  //   - { kind: 'pending_quorum', have, need }      — vote recorded, more votes needed
  //   - { kind: 'decided', pending }                — quorum reached, request replayed and decided
  async approveWithQuorum(input: DecisionInput): Promise<ApprovalAttemptResult> {
    // Fetch the originating rule to learn quorum + justification policy.
    const rule = await this.lookupRuleForPending(input.pendingId);
    const cfg = (rule?.actionConfig as any) ?? {};
    const requireJustification = Boolean(cfg.requireJustification);
    const quorumRequired = Number.isInteger(cfg.quorumRequired) && cfg.quorumRequired > 0
      ? cfg.quorumRequired : 1;

    if (requireJustification && !input.justification?.trim()) {
      return { kind: 'rejected_missing_justification' };
    }

    // Record this vote. Unique constraint on (pendingId, approverSlackUserId) makes
    // a second click from the same approver a graceful no-op.
    try {
      await this.prisma.pendingRequestApproval.create({
        data: {
          pendingRequestId: input.pendingId,
          approverSlackUserId: input.approverSlackUserId,
          approverSlackUserName: input.approverSlackUserName,
          justification: input.justification?.trim() || null,
          decision: 'APPROVED',
        },
      });
    } catch (err: any) {
      // P2002 = unique constraint violation — this approver already voted.
      if (err?.code === 'P2002') {
        const have = await this.prisma.pendingRequestApproval.count({
          where: { pendingRequestId: input.pendingId, decision: 'APPROVED' },
        });
        return { kind: 'already_voted', have, need: quorumRequired };
      }
      throw err;
    }

    const have = await this.prisma.pendingRequestApproval.count({
      where: { pendingRequestId: input.pendingId, decision: 'APPROVED' },
    });
    if (have < quorumRequired) {
      return { kind: 'pending_quorum', have, need: quorumRequired };
    }

    // Quorum reached. Run the existing replay flow.
    const pending = await this.approve(input);
    return { kind: 'decided', pending };
  }

  // Internal: looks up the PolicyRule that triggered the given pending request.
  // Returns null if the rule was deleted between the hold and the decision.
  private async lookupRuleForPending(pendingId: string) {
    const pending = await this.prisma.pendingRequest.findUnique({
      where: { id: pendingId },
      select: { ruleId: true, organizationId: true },
    });
    if (!pending) return null;
    return this.prisma.policyRule.findFirst({
      where: { id: pending.ruleId, organizationId: pending.organizationId },
    });
  }

  async approve(input: DecisionInput) {
    const pending = await this.transitionPending(input.pendingId, 'APPROVED', {
      approverSlackUserId: input.approverSlackUserId,
      approverSlackUserName: input.approverSlackUserName,
    });
    if (!pending) return null;

    // Replay through the proxy with bypassApproval so MUTATION_APPROVAL is skipped
    // (other rules — BLOCK / RATE_LIMIT / AUDIT — still apply).
    const replay: AgentRequest = {
      organizationId: pending.organizationId,
      agentId: pending.agentId ?? null,
      method: pending.method,
      path: pending.path,
      source: pending.source as 'internal_mcp' | 'external_mcp',
      tenantId: pending.tenantId ?? undefined,
      headers: pending.reasoning ? { 'x-agent-reasoning': pending.reasoning } : {},
      query: (pending.query as any) ?? undefined,
      body: (pending.body as any) ?? undefined,
      bypassApproval: true,
    };

    const startedAt = Date.now();
    let captured: { status: number | null; headers: any; body: any } = { status: null, headers: null, body: null };
    let actionTaken: 'EXECUTED' | 'BLOCKED' = 'EXECUTED';
    let auditReason: string | null = `approved by ${input.approverSlackUserName}`;

    try {
      const out = await this.proxy.interceptAndExecute(replay);
      if (out.kind === 'policy') {
        // Some non-approval rule blocked even after approval (e.g. RATE_LIMIT).
        actionTaken = 'BLOCKED';
        auditReason = `replay blocked: ${out.reason}`;
        captured = { status: null, headers: null, body: { error: out.reason } };
      } else {
        captured = await this.captureStream(out.status, out.headers, out.stream);
      }
    } catch (err: any) {
      const status = err?.status ?? 502;
      actionTaken = 'BLOCKED';
      auditReason = `replay error: ${err?.message ?? 'unknown'}`;
      captured = { status, headers: null, body: { error: err?.message } };
    }

    await this.prisma.pendingRequest.update({
      where: { id: pending.id },
      data: {
        responseStatus: captured.status,
        responseHeaders: captured.headers,
        responseBody: captured.body,
      },
    });

    this.audit.recordSafe({
      organizationId: pending.organizationId,
      apiKeyId: pending.apiKeyId,
      agentId: pending.agentId,
      method: pending.method,
      path: pending.path,
      source: pending.source as any,
      tenantId: pending.tenantId,
      reasoning: pending.reasoning,
      reason: auditReason,
      actionTaken,
      upstreamStatus: captured.status,
      requestBytes: pending.body ? Buffer.byteLength(JSON.stringify(pending.body)) : 0,
      responseBytes: captured.body ? Buffer.byteLength(JSON.stringify(captured.body)) : null,
      latencyMs: Date.now() - startedAt,
    });

    // Update Slack message
    try {
      const org = await this.prisma.organization.findUnique({
        where: { id: pending.organizationId },
        select: { slackBotToken: true },
      });
      if (org?.slackBotToken && pending.channel && pending.slackMessageTs) {
        const token = decryptSecret(org.slackBotToken);
        await this.slack.updateMessageDecision(
          token,
          { channel: pending.channel, ts: pending.slackMessageTs },
          this.toMessageInput(pending),
          'APPROVED',
          input.approverSlackUserId,
        );
      }
    } catch (err: any) {
      this.logger.warn(`chat.update failed for ${pending.id}: ${err.message}`);
    }

    this.metrics?.recordApproval('approved');
    return this.prisma.pendingRequest.findUnique({ where: { id: pending.id } });
  }

  async deny(input: DecisionInput, reason?: string) {
    const pending = await this.transitionPending(input.pendingId, 'DENIED', {
      approverSlackUserId: input.approverSlackUserId,
      approverSlackUserName: input.approverSlackUserName,
      decisionReason: reason ?? null,
    });
    if (!pending) return null;

    this.audit.recordSafe({
      organizationId: pending.organizationId,
      apiKeyId: pending.apiKeyId,
      agentId: pending.agentId,
      method: pending.method,
      path: pending.path,
      source: pending.source as any,
      tenantId: pending.tenantId,
      reasoning: pending.reasoning,
      reason: `denied by ${input.approverSlackUserName}${reason ? ': ' + reason : ''}`,
      actionTaken: 'BLOCKED',
      upstreamStatus: null,
      requestBytes: pending.body ? Buffer.byteLength(JSON.stringify(pending.body)) : 0,
      responseBytes: null,
      latencyMs: 0,
    });

    try {
      const org = await this.prisma.organization.findUnique({
        where: { id: pending.organizationId },
        select: { slackBotToken: true },
      });
      if (org?.slackBotToken && pending.channel && pending.slackMessageTs) {
        const token = decryptSecret(org.slackBotToken);
        await this.slack.updateMessageDecision(
          token,
          { channel: pending.channel, ts: pending.slackMessageTs },
          this.toMessageInput(pending),
          'DENIED',
          input.approverSlackUserId,
        );
      }
    } catch (err: any) {
      this.logger.warn(`chat.update failed for ${pending.id}: ${err.message}`);
    }

    this.metrics?.recordApproval('denied');
    return pending;
  }

  // Lazy expiration on read. Marks any PENDING row past TTL as EXPIRED + audits.
  async getById(organizationId: string, id: string) {
    const row = await this.prisma.pendingRequest.findFirst({
      where: { id, organizationId },
    });
    if (!row) throw new NotFoundException();
    if (row.status === 'PENDING' && row.expiresAt < new Date()) {
      return this.expire(row.id);
    }
    return row;
  }

  async expire(id: string) {
    const expired = await this.transitionPending(id, 'EXPIRED', {});
    if (!expired) return null;
    this.audit.recordSafe({
      organizationId: expired.organizationId,
      apiKeyId: expired.apiKeyId,
      agentId: expired.agentId,
      method: expired.method,
      path: expired.path,
      source: expired.source as any,
      tenantId: expired.tenantId,
      reasoning: expired.reasoning,
      reason: `approval expired after TTL`,
      actionTaken: 'BLOCKED',
      upstreamStatus: null,
      requestBytes: expired.body ? Buffer.byteLength(JSON.stringify(expired.body)) : 0,
      responseBytes: null,
      latencyMs: 0,
    });
    this.metrics?.recordApproval('expired');
    return expired;
  }

  // Sweep for expired requests. Called by ApprovalSweeper @Interval.
  async sweepExpired(now = new Date()): Promise<number> {
    const stale = await this.prisma.pendingRequest.findMany({
      where: { status: 'PENDING', expiresAt: { lt: now } },
      select: { id: true },
      take: 100,
    });
    for (const s of stale) {
      await this.expire(s.id).catch((e) => this.logger.warn(`expire ${s.id} failed: ${e.message}`));
    }
    return stale.length;
  }

  // Idempotent state transition. Returns null if the row was already terminal.
  private async transitionPending(
    id: string,
    nextStatus: 'APPROVED' | 'DENIED' | 'EXPIRED',
    fields: Record<string, any>,
  ) {
    const result = await this.prisma.pendingRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { ...fields, status: nextStatus, decidedAt: new Date() },
    });
    if (result.count === 0) return null;
    return this.prisma.pendingRequest.findUnique({ where: { id } });
  }

  private async captureStream(status: number, headers: any, stream: NodeJS.ReadableStream) {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let truncated = false;
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        chunks.push(Buffer.from(chunk.toString('utf8').slice(0, MAX_BODY_BYTES - (bytes - chunk.length))));
        truncated = true;
        break;
      }
      chunks.push(chunk);
    }
    const buf = Buffer.concat(chunks);
    let body: any;
    const text = buf.toString('utf8');
    try {
      body = JSON.parse(text);
    } catch {
      body = { _text: text + (truncated ? '\n[truncated]' : '') };
    }
    if (truncated && typeof body === 'object' && body !== null) body._truncated = true;
    return { status, headers, body };
  }

  private toMessageInput(pending: any) {
    return {
      pendingId: pending.id,
      agentName: pending.agentId ?? 'unknown',
      source: pending.source,
      tenantId: pending.tenantId,
      method: pending.method,
      path: pending.path,
      reasoning: pending.reasoning,
      ruleName: pending.ruleName,
      expiresAt: pending.expiresAt,
    };
  }
}
