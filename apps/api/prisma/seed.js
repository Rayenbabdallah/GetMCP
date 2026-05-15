const { PrismaClient } = require('@prisma/client');
const { randomBytes, scrypt: scryptCb } = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(scryptCb);
const prisma = new PrismaClient();

async function mintKey() {
  const plaintext = `gmcp_${randomBytes(24).toString('base64url')}`;
  const prefix = plaintext.slice(0, 8);
  const salt = randomBytes(16);
  const derived = await scrypt(plaintext, salt, 64);
  const hash = `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
  return { plaintext, prefix, hash };
}

async function main() {
  const org = await prisma.organization.create({
    data: { name: 'Stripe Inc.', authType: 'Okta' },
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
    data: [
      {
        organizationId: org.id,
        name: 'Require Human Approval for Refunds',
        description:
          'Any agent attempting to hit POST /v1/refunds via the External MCP must receive explicit Slack approval from the @finance-ops team before execution.',
        ruleType: 'MUTATION_APPROVAL',
        targetMethod: 'POST',
        targetPath: '/v1/refunds',
        action: 'SLACK_APPROVAL',
        actionConfig: { channel: '#finance-ops' },
        isActive: true,
      },
      {
        organizationId: org.id,
        name: 'Tenant Isolation Quota',
        description:
          'Agents acting on behalf of a tenant cannot exceed 50 read queries per minute to prevent DB monopolization.',
        ruleType: 'RATE_LIMIT',
        targetMethod: 'POST',
        targetPath: '*',
        action: 'BLOCK',
        actionConfig: {},
        isActive: true,
      },
      {
        organizationId: org.id,
        name: 'Mandatory Context Logging',
        description:
          'All requests must include a valid X-Agent-Reasoning header detailing why the action was taken.',
        ruleType: 'AUDIT',
        targetMethod: '*',
        targetPath: '*',
        action: 'REQUIRE_HEADER',
        actionConfig: {},
        isActive: true,
      },
    ],
  });

  const internalAgent = await prisma.agentIdentity.create({
    data: {
      organizationId: org.id,
      name: 'seed-internal-agent',
      source: 'internal_mcp',
    },
  });
  const externalAgent = await prisma.agentIdentity.create({
    data: {
      organizationId: org.id,
      name: 'seed-external-agent',
      source: 'external_mcp',
    },
  });

  console.log('Database seeded.');
  console.log(`Organization id: ${org.id}`);
  console.log(`Internal agent id: ${internalAgent.id}`);
  console.log(`External agent id: ${externalAgent.id}`);
  console.log('');
  console.log('API key (store it now — it will not be shown again):');
  console.log(`  ${key.plaintext}`);
  console.log('');
  console.log('Test it:');
  console.log(`  curl -H "Authorization: Bearer ${key.plaintext}" http://localhost:3000/proxy/policies`);
  console.log('');
  console.log('Proxy a request as the internal agent:');
  console.log(`  curl -X POST http://localhost:3000/proxy/execute \\`);
  console.log(`    -H "Authorization: Bearer ${key.plaintext}" \\`);
  console.log(`    -H "x-agent-id: ${internalAgent.id}" \\`);
  console.log(`    -H "x-agent-source: internal_mcp" \\`);
  console.log(`    -H "Content-Type: application/json" \\`);
  console.log(`    -d '{"method":"GET","path":"/v1/charges"}'`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
