const { PrismaClient } = require('@prisma/client');
const { randomBytes, scrypt: scryptCb } = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(scryptCb);
const prisma = new PrismaClient();

const STARTER_PACK = process.argv.includes('--starter-pack');

async function mintKey() {
  const plaintext = `gmcp_${randomBytes(24).toString('base64url')}`;
  const prefix = plaintext.slice(0, 8);
  const salt = randomBytes(16);
  const derived = await scrypt(plaintext, salt, 64);
  const hash = `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
  return { plaintext, prefix, hash };
}

// The recommended day-1 default for any team standing this up.
// Read-only allowed, all mutations rate-limited, deletes hard-blocked,
// sensitive paths held for Slack approval.
const STARTER_POLICIES = [
  {
    name: 'Mandatory reasoning',
    description:
      'Every external request must include a non-trivial x-agent-reasoning header (≥10 chars, not boilerplate).',
    ruleType: 'AUDIT',
    targetMethod: '*',
    targetPath: '*',
    action: 'REQUIRE_HEADER',
    actionConfig: {},
    priority: 5,
  },
  {
    name: 'No external deletes',
    description: 'DELETE is never permitted from external_mcp. Use the internal MCP for destructive operations.',
    ruleType: 'BLOCK',
    targetMethod: 'DELETE',
    targetPath: '*',
    action: 'BLOCK',
    actionConfig: {},
    priority: 10,
  },
  {
    name: 'Read-only allowlist',
    description: 'GET requests on /v1/* are always permitted (short-circuits later rate-limit / approval rules).',
    ruleType: 'ALLOWLIST',
    targetMethod: 'GET',
    targetPath: '/v1/*',
    action: 'ALLOW',
    actionConfig: {},
    priority: 30,
  },
  {
    name: 'Mutation rate limit',
    description: 'Mutations capped at 50 per minute per (agent, tenant). Tune via actionConfig.',
    ruleType: 'RATE_LIMIT',
    targetMethod: 'POST',
    targetPath: '*',
    action: 'RATE_LIMIT',
    actionConfig: { limit: 50, windowMs: 60000, scope: 'agent+tenant' },
    priority: 50,
  },
  {
    name: 'Sensitive mutation approval (template)',
    description:
      'Slack approval for POST /v1/refunds. Replace the path with whatever your sensitive endpoints are.',
    ruleType: 'MUTATION_APPROVAL',
    targetMethod: 'POST',
    targetPath: '/v1/refunds',
    action: 'SLACK_APPROVAL',
    actionConfig: { channel: '#approvals' },
    priority: 60,
  },
];

// The original demo set — kept for the default (no-flag) path so existing
// behavior is preserved. The starter-pack above is a sharper recommendation
// for real teams; this demo is biased toward "Stripe-like" examples.
const DEMO_POLICIES = [
  {
    name: 'Require Human Approval for Refunds',
    description:
      'Any agent attempting to hit POST /v1/refunds via the External MCP must receive explicit Slack approval from the @finance-ops team before execution.',
    ruleType: 'MUTATION_APPROVAL',
    targetMethod: 'POST',
    targetPath: '/v1/refunds',
    action: 'SLACK_APPROVAL',
    actionConfig: { channel: '#finance-ops' },
    priority: 50,
  },
  {
    name: 'Tenant Isolation Quota',
    description:
      'Agents acting on behalf of a tenant cannot exceed 50 mutations per minute to prevent DB monopolization.',
    ruleType: 'RATE_LIMIT',
    targetMethod: 'POST',
    targetPath: '*',
    action: 'RATE_LIMIT',
    actionConfig: { limit: 50, windowMs: 60000, scope: 'agent+tenant' },
    priority: 100,
  },
  {
    name: 'Mandatory Context Logging',
    description:
      'All requests must include a non-trivial X-Agent-Reasoning header explaining the action.',
    ruleType: 'AUDIT',
    targetMethod: '*',
    targetPath: '*',
    action: 'REQUIRE_HEADER',
    actionConfig: {},
    priority: 10,
  },
];

async function main() {
  const policies = STARTER_PACK ? STARTER_POLICIES : DEMO_POLICIES;
  const orgName = STARTER_PACK ? 'Starter Org' : 'Stripe Inc.';

  const org = await prisma.organization.create({
    data: { name: orgName, authType: 'Okta' },
  });

  const key = await mintKey();
  await prisma.apiKey.create({
    data: {
      organizationId: org.id,
      name: 'seed-bootstrap-key',
      prefix: key.prefix,
      hash: key.hash,
    },
  });

  await prisma.policyRule.createMany({
    data: policies.map((p) => ({ ...p, organizationId: org.id, isActive: true })),
  });

  const internalAgent = await prisma.agentIdentity.create({
    data: { organizationId: org.id, name: 'seed-internal-agent', source: 'internal_mcp' },
  });
  const externalAgent = await prisma.agentIdentity.create({
    data: { organizationId: org.id, name: 'seed-external-agent', source: 'external_mcp' },
  });

  console.log(`Database seeded${STARTER_PACK ? ' with the starter policy pack' : ''}.`);
  console.log(`Organization id:    ${org.id}`);
  console.log(`Internal agent id:  ${internalAgent.id}`);
  console.log(`External agent id:  ${externalAgent.id}`);
  console.log(`Policies installed: ${policies.length} (${policies.map((p) => p.ruleType).join(', ')})`);
  console.log('');
  console.log('API key (store it now — it will not be shown again):');
  console.log(`  ${key.plaintext}`);
  console.log('');
  console.log('Test it:');
  console.log(`  curl -H "Authorization: Bearer ${key.plaintext}" http://localhost:3000/policies`);
  console.log('');
  console.log('Proxy a request as the internal agent:');
  console.log(`  curl -X POST http://localhost:3000/proxy/execute \\`);
  console.log(`    -H "Authorization: Bearer ${key.plaintext}" \\`);
  console.log(`    -H "x-agent-id: ${internalAgent.id}" \\`);
  console.log(`    -H "x-agent-source: internal_mcp" \\`);
  console.log(`    -H "x-agent-reasoning: smoke test from seed output" \\`);
  console.log(`    -H "Content-Type: application/json" \\`);
  console.log(`    -d '{"method":"GET","path":"/v1/charges"}'`);
  if (!STARTER_PACK) {
    console.log('');
    console.log('Tip: re-run with `node prisma/seed.js --starter-pack` for the recommended day-1 policy set.');
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
