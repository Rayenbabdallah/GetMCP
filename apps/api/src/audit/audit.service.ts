import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { computeAuditHash, rowToHashable } from './canonical.util';
import { MetricsService } from '../metrics/metrics.service';

export interface AuditInput {
  organizationId: string;
  apiKeyId?: string | null;
  agentId?: string | null;
  method: string;
  path: string;
  source: 'internal_mcp' | 'external_mcp' | 'system';
  tenantId?: string | null;
  reasoning?: string | null;
  reason?: string | null;
  actionTaken: 'EXECUTED' | 'BLOCKED' | 'AWAITING_APPROVAL' | 'INCOMPLETE';
  upstreamStatus?: number | null;
  requestBytes?: number;
  responseBytes?: number | null;
  latencyMs: number;
}

export type VerifyResult =
  | { valid: true; rowCount: number; lastHash: string }
  | {
      valid: false;
      brokenAtSeq: number;
      reason: 'prev_hash_mismatch' | 'hash_mismatch' | 'gap_in_seq';
      expected: string;
      actual: string;
    };

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  // Atomic, chain-extending insert. Serializable isolation prevents two
  // concurrent writers from claiming the same `seq` for one organization;
  // Prisma will throw P2034 on a serialization conflict and we retry.
  async record(input: AuditInput): Promise<{ id: string; seq: number; hash: string }> {
    const MAX_RETRIES = 5;
    let attempt = 0;
    while (true) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const org = await tx.organization.findUnique({
              where: { id: input.organizationId },
              select: { lastAuditHash: true, lastAuditSeq: true },
            });
            if (!org) throw new NotFoundException(`Org ${input.organizationId} not found`);

            const seq = org.lastAuditSeq + 1;
            const prevHash = org.lastAuditHash;
            const timestamp = new Date();

            const hashable = rowToHashable({
              organizationId: input.organizationId,
              seq,
              timestamp,
              method: input.method,
              path: input.path,
              source: input.source,
              tenantId: input.tenantId ?? null,
              agentId: input.agentId ?? null,
              apiKeyId: input.apiKeyId ?? null,
              reasoning: input.reasoning ?? null,
              reason: input.reason ?? null,
              actionTaken: input.actionTaken,
              upstreamStatus: input.upstreamStatus ?? null,
              requestBytes: input.requestBytes ?? 0,
              responseBytes: input.responseBytes ?? null,
              latencyMs: input.latencyMs,
              prevHash,
            });
            const hash = computeAuditHash(hashable);

            const created = await tx.auditLog.create({
              data: {
                organizationId: input.organizationId,
                seq,
                timestamp,
                method: input.method,
                path: input.path,
                source: input.source,
                tenantId: input.tenantId ?? null,
                agentId: input.agentId ?? null,
                apiKeyId: input.apiKeyId ?? null,
                reasoning: input.reasoning ?? null,
                reason: input.reason ?? null,
                actionTaken: input.actionTaken,
                upstreamStatus: input.upstreamStatus ?? null,
                requestBytes: input.requestBytes ?? 0,
                responseBytes: input.responseBytes ?? null,
                latencyMs: input.latencyMs,
                prevHash,
                hash,
              },
            });

            await tx.organization.update({
              where: { id: input.organizationId },
              data: { lastAuditHash: hash, lastAuditSeq: seq },
            });

            return { id: created.id, seq, hash };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (err: any) {
        // P2034 = serialization failure; P2002 on (orgId,seq) = lost race.
        const retriable = err?.code === 'P2034' || err?.code === 'P2002';
        if (retriable && attempt < MAX_RETRIES) {
          attempt++;
          await new Promise((r) => setTimeout(r, 5 * attempt));
          continue;
        }
        throw err;
      }
    }
  }

  // Walk the entire chain for an org, recomputing each hash. Returns the first
  // broken link, or { valid: true } with the head.
  async verifyChain(organizationId: string): Promise<VerifyResult> {
    const PAGE = 500;
    let prevHash = 'genesis';
    let expectedSeq = 1;
    let cursor: string | undefined;
    let lastHash = prevHash;
    let count = 0;

    while (true) {
      const rows: any[] = await this.prisma.auditLog.findMany({
        where: { organizationId },
        orderBy: { seq: 'asc' },
        take: PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (rows.length === 0) break;

      for (const row of rows) {
        if (row.seq !== expectedSeq) {
          return {
            valid: false,
            brokenAtSeq: row.seq,
            reason: 'gap_in_seq',
            expected: String(expectedSeq),
            actual: String(row.seq),
          };
        }
        if (row.prevHash !== prevHash) {
          return {
            valid: false,
            brokenAtSeq: row.seq,
            reason: 'prev_hash_mismatch',
            expected: prevHash,
            actual: row.prevHash,
          };
        }
        const recomputed = computeAuditHash(rowToHashable(row));
        if (recomputed !== row.hash) {
          return {
            valid: false,
            brokenAtSeq: row.seq,
            reason: 'hash_mismatch',
            expected: recomputed,
            actual: row.hash,
          };
        }
        prevHash = row.hash;
        lastHash = row.hash;
        expectedSeq++;
        count++;
      }

      cursor = rows[rows.length - 1].id;
      if (rows.length < PAGE) break;
    }

    return { valid: true, rowCount: count, lastHash };
  }

  // Fire-and-log wrapper for the proxy hot path. Audit failures must not
  // crash the response — they get logged loudly and (TODO) eventually
  // need an outbox + recovery worker.
  recordSafe(input: AuditInput): void {
    this.record(input)
      .then(() => this.metrics?.recordAudit('ok'))
      .catch((err) => {
        this.metrics?.recordAudit('failed');
        this.logger.error(
          `AUDIT WRITE FAILED for org=${input.organizationId} path=${input.path}: ${err.message}`,
          err.stack,
        );
      });
  }
}
