// The original keyword/verb heuristics from §0, extracted as the fallback
// classifier when ANTHROPIC_API_KEY is not set.

const SENSITIVE_PATH_KEYWORDS = ['admin', 'internal', 'billing', 'sudo', 'logs', 'metrics', 'webhook', 'system', 'config'];
const DANGEROUS_VERBS = new Set(['delete', 'patch']);
const PII_KEYWORDS = ['ssn', 'password', 'credit_card', 'card_number', 'social_security', 'secret', 'token'];

function containsKeyword(text: string, keywords: string[]) {
  if (!text) return false;
  const t = text.toLowerCase();
  return keywords.some((k) => t.includes(k));
}

export interface HeuristicVerdict {
  dataSensitivity: number;
  mutationImpact: number;
  hasTenantScope: boolean;
  reversible: boolean;
  exposeExternally: boolean;
  reasoning: string;
}

export function heuristicClassify(path: string, method: string, op: any): HeuristicVerdict {
  const reasons: string[] = [];
  const verb = method.toLowerCase();

  let dataSensitivity = 20;
  let mutationImpact = 0;

  if (containsKeyword(path, SENSITIVE_PATH_KEYWORDS)) {
    dataSensitivity = 90;
    reasons.push(`sensitive path keyword`);
  }

  if (DANGEROUS_VERBS.has(verb)) {
    mutationImpact = 85;
    reasons.push(`dangerous verb (${verb})`);
  } else if (verb === 'post' || verb === 'put') {
    mutationImpact = 50;
  }

  const description = `${op?.description ?? ''} ${op?.summary ?? ''}`;
  if (containsKeyword(description, SENSITIVE_PATH_KEYWORDS)) {
    dataSensitivity = Math.max(dataSensitivity, 80);
    reasons.push('sensitive description');
  }
  if (Array.isArray(op?.tags) && containsKeyword(op.tags.join(' '), SENSITIVE_PATH_KEYWORDS)) {
    dataSensitivity = Math.max(dataSensitivity, 80);
    reasons.push('sensitive tags');
  }

  const params = Array.isArray(op?.parameters) ? op.parameters : [];
  const piiParams = params.filter(
    (p: any) => containsKeyword(p?.name ?? '', PII_KEYWORDS) || containsKeyword(p?.description ?? '', PII_KEYWORDS),
  );
  if (piiParams.length > 0) {
    dataSensitivity = Math.max(dataSensitivity, 95);
    reasons.push(`PII parameters (${piiParams.map((p: any) => p.name).join(', ')})`);
  }

  const tenantParam = params.find((p: any) => {
    const name = (p?.name ?? '').toLowerCase();
    return name.includes('tenant') || name.includes('user_id') || name.includes('customer');
  });
  const hasTenantScope = Boolean(tenantParam) || /\{[A-Za-z_][A-Za-z0-9_]*\}/.test(path);

  const reversible = !DANGEROUS_VERBS.has(verb);

  let exposeExternally = true;
  if (containsKeyword(path, SENSITIVE_PATH_KEYWORDS)) exposeExternally = false;
  if (DANGEROUS_VERBS.has(verb)) exposeExternally = false;
  if (containsKeyword(description, SENSITIVE_PATH_KEYWORDS)) exposeExternally = false;
  if (piiParams.length > 0) exposeExternally = false;
  if ((verb === 'post' || verb === 'put') && !hasTenantScope) {
    exposeExternally = false;
    reasons.push('global mutation lacking tenant scope');
  }

  return {
    dataSensitivity,
    mutationImpact,
    hasTenantScope,
    reversible,
    exposeExternally,
    reasoning: `heuristic: ${reasons.length ? reasons.join('; ') : 'no risk indicators detected'}`,
  };
}
