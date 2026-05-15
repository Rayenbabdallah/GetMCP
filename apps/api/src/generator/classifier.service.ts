import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma.service';
import { specHash } from './spec-hash.util';
import { heuristicClassify } from './heuristic';

export interface ClassifiedEndpoint {
  path: string;
  method: string;
  dataSensitivity: number;
  mutationImpact: number;
  hasTenantScope: boolean;
  reversible: boolean;
  exposeExternally: boolean;
  reasoning: string;
  classifierSource: 'llm' | 'heuristic';
  overrideExposeExternally?: boolean | null;
}

export interface ClassifyResult {
  specHash: string;
  source: 'llm' | 'heuristic';
  cacheHit: boolean;
  endpoints: ClassifiedEndpoint[];
}

const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const BATCH_SIZE = 40;

@Injectable()
export class ClassifierService {
  private readonly logger = new Logger(ClassifierService.name);

  constructor(private readonly prisma: PrismaService) {}

  async classify(organizationId: string, spec: any): Promise<ClassifyResult> {
    if (!spec || !spec.paths) throw new Error('Invalid spec: missing paths');

    const hash = specHash(spec);

    // Cache lookup — if every endpoint in this spec is already classified for
    // this hash, return the cached set with overrides applied.
    const cached = await this.prisma.endpointClassification.findMany({
      where: { organizationId, specHash: hash },
    });
    const expected = countEndpoints(spec);
    if (cached.length === expected) {
      return {
        specHash: hash,
        source: cached[0]?.classifierSource as any,
        cacheHit: true,
        endpoints: cached.map(toClassified),
      };
    }

    const useLlm = Boolean(process.env.ANTHROPIC_API_KEY);
    const fresh = useLlm
      ? await this.classifyWithLlm(spec).catch((err) => {
          this.logger.warn(`LLM classify failed, falling back to heuristics: ${err.message}`);
          return this.classifyHeuristically(spec);
        })
      : this.classifyHeuristically(spec);

    // Persist (idempotent on the unique constraint).
    await this.prisma.$transaction(
      fresh.map((e) =>
        this.prisma.endpointClassification.upsert({
          where: {
            organizationId_specHash_path_method: {
              organizationId,
              specHash: hash,
              path: e.path,
              method: e.method,
            },
          },
          create: {
            organizationId,
            specHash: hash,
            path: e.path,
            method: e.method,
            dataSensitivity: e.dataSensitivity,
            mutationImpact: e.mutationImpact,
            hasTenantScope: e.hasTenantScope,
            reversible: e.reversible,
            exposeExternally: e.exposeExternally,
            reasoning: e.reasoning,
            classifierSource: e.classifierSource,
          },
          update: {
            dataSensitivity: e.dataSensitivity,
            mutationImpact: e.mutationImpact,
            hasTenantScope: e.hasTenantScope,
            reversible: e.reversible,
            exposeExternally: e.exposeExternally,
            reasoning: e.reasoning,
            classifierSource: e.classifierSource,
          },
        }),
      ),
    );

    const stored = await this.prisma.endpointClassification.findMany({
      where: { organizationId, specHash: hash },
    });

    return {
      specHash: hash,
      source: useLlm ? 'llm' : 'heuristic',
      cacheHit: false,
      endpoints: stored.map(toClassified),
    };
  }

  async setOverride(input: {
    organizationId: string;
    apiKeyId: string;
    specHash: string;
    path: string;
    method: string;
    exposeExternally: boolean | null; // null clears the override
    reason?: string;
  }) {
    const existing = await this.prisma.endpointClassification.findFirst({
      where: {
        organizationId: input.organizationId,
        specHash: input.specHash,
        path: input.path,
        method: input.method,
      },
    });
    if (!existing) throw new Error('classification not found — classify the spec first');
    return this.prisma.endpointClassification.update({
      where: { id: existing.id },
      data: {
        overrideExposeExternally: input.exposeExternally,
        overrideBy: input.exposeExternally === null ? null : input.apiKeyId,
        overrideAt: input.exposeExternally === null ? null : new Date(),
        overrideReason: input.exposeExternally === null ? null : (input.reason ?? null),
      },
    });
  }

  // Effective verdict applies override on top of classifier output.
  effectiveVerdict(c: ClassifiedEndpoint): boolean {
    return c.overrideExposeExternally !== null && c.overrideExposeExternally !== undefined
      ? Boolean(c.overrideExposeExternally)
      : c.exposeExternally;
  }

  private classifyHeuristically(spec: any): ClassifiedEndpoint[] {
    const out: ClassifiedEndpoint[] = [];
    for (const [path, methods] of Object.entries(spec.paths) as [string, any][]) {
      for (const [method, op] of Object.entries(methods)) {
        const v = heuristicClassify(path, method, op);
        out.push({
          path,
          method: method.toLowerCase(),
          ...v,
          classifierSource: 'heuristic',
        });
      }
    }
    return out;
  }

  private async classifyWithLlm(spec: any): Promise<ClassifiedEndpoint[]> {
    const apiKey = process.env.ANTHROPIC_API_KEY!;
    const all: ClassifiedEndpoint[] = [];

    const flat: Array<{ path: string; method: string; op: any }> = [];
    for (const [path, methods] of Object.entries(spec.paths) as [string, any][]) {
      for (const [method, op] of Object.entries(methods)) {
        flat.push({ path, method: method.toLowerCase(), op });
      }
    }

    for (let i = 0; i < flat.length; i += BATCH_SIZE) {
      const batch = flat.slice(i, i + BATCH_SIZE);
      const verdicts = await this.callAnthropic(apiKey, batch);
      // Merge by (path, method); fall back to heuristic for any the model skipped.
      for (const item of batch) {
        const key = `${item.method} ${item.path}`;
        const v = verdicts.get(key);
        if (v) {
          all.push({ ...v, classifierSource: 'llm' });
        } else {
          this.logger.warn(`LLM skipped ${key}, using heuristic`);
          const h = heuristicClassify(item.path, item.method, item.op);
          all.push({ path: item.path, method: item.method, ...h, classifierSource: 'heuristic' });
        }
      }
    }
    return all;
  }

  private async callAnthropic(
    apiKey: string,
    batch: Array<{ path: string; method: string; op: any }>,
  ): Promise<Map<string, ClassifiedEndpoint>> {
    const endpointsForPrompt = batch.map((b) => ({
      path: b.path,
      method: b.method,
      summary: b.op?.summary ?? '',
      description: b.op?.description ?? '',
      tags: b.op?.tags ?? [],
      parameters: (b.op?.parameters ?? []).map((p: any) => ({
        name: p?.name,
        in: p?.in,
        required: p?.required,
        description: p?.description,
      })),
      requestBody: b.op?.requestBody ? { required: !!b.op.requestBody.required } : null,
    }));

    const system =
      'You are GetMCP\'s endpoint risk classifier. For each OpenAPI endpoint, score data sensitivity (0-100), mutation impact (0-100), whether it has tenant scope, and whether the action is reversible. Then decide if it is safe to expose to external customer-facing AI agents. Be conservative — when in doubt, mark exposeExternally=false. Respond with JSON only, matching the schema in the user message.';

    const user = `Classify these endpoints. Respond with a JSON object: {"endpoints":[{"path","method","dataSensitivity","mutationImpact","hasTenantScope","reversible","exposeExternally","reasoning"}]}.

Endpoints:
${JSON.stringify(endpointsForPrompt, null, 2)}`;

    const resp = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: ANTHROPIC_MODEL,
        max_tokens: 8000,
        system,
        messages: [{ role: 'user', content: user }],
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        timeout: 60_000,
      },
    );

    const text = resp.data?.content?.[0]?.text ?? '';
    const json = extractJsonObject(text);
    if (!json || !Array.isArray(json.endpoints)) {
      throw new Error('LLM response missing endpoints array');
    }

    const out = new Map<string, ClassifiedEndpoint>();
    for (const e of json.endpoints) {
      if (!e || typeof e.path !== 'string' || typeof e.method !== 'string') continue;
      const method = e.method.toLowerCase();
      out.set(`${method} ${e.path}`, {
        path: e.path,
        method,
        dataSensitivity: clampInt(e.dataSensitivity, 0, 100),
        mutationImpact: clampInt(e.mutationImpact, 0, 100),
        hasTenantScope: Boolean(e.hasTenantScope),
        reversible: Boolean(e.reversible),
        exposeExternally: Boolean(e.exposeExternally),
        reasoning: typeof e.reasoning === 'string' ? e.reasoning : 'llm: (no reasoning provided)',
        classifierSource: 'llm',
      });
    }
    return out;
  }
}

function countEndpoints(spec: any): number {
  let n = 0;
  for (const methods of Object.values(spec.paths ?? {})) {
    n += Object.keys(methods as object).length;
  }
  return n;
}

function clampInt(n: any, lo: number, hi: number): number {
  const x = typeof n === 'number' ? Math.round(n) : 0;
  return Math.max(lo, Math.min(hi, x));
}

function extractJsonObject(text: string): any {
  // Strip markdown fences and locate the outer braces. Models occasionally
  // wrap JSON in ```json fences even when told not to.
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function toClassified(row: any): ClassifiedEndpoint {
  return {
    path: row.path,
    method: row.method,
    dataSensitivity: row.dataSensitivity,
    mutationImpact: row.mutationImpact,
    hasTenantScope: row.hasTenantScope,
    reversible: row.reversible,
    exposeExternally: row.exposeExternally,
    reasoning: row.reasoning,
    classifierSource: row.classifierSource as any,
    overrideExposeExternally: row.overrideExposeExternally,
  };
}
