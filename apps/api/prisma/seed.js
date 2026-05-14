const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.create({
    data: {
      name: 'Stripe Inc.',
      authType: 'Okta'
    }
  });

  await prisma.policyRule.createMany({
    data: [
      {
        organizationId: org.id,
        name: 'Require Human Approval for Refunds',
        description: 'Any agent attempting to hit POST /v1/refunds via the External MCP must receive explicit Slack approval from the @finance-ops team before execution.',
        ruleType: 'MUTATION_APPROVAL',
        targetMethod: 'POST',
        targetPath: '/v1/refunds',
        action: 'SLACK_APPROVAL',
        actionConfig: { "channel": "#finance-ops" },
        isActive: true
      },
      {
        organizationId: org.id,
        name: 'Tenant Isolation Quota',
        description: 'Agents acting on behalf of a tenant cannot exceed 50 read queries per minute to prevent DB monopolization.',
        ruleType: 'RATE_LIMIT',
        targetMethod: 'POST', // Only applying tenant checking on POST for MVP
        targetPath: '*',
        action: 'BLOCK',
        actionConfig: {},
        isActive: true
      },
      {
        organizationId: org.id,
        name: 'Mandatory Context Logging',
        description: 'All requests must include a valid X-Agent-Reasoning header detailing why the action was taken.',
        ruleType: 'AUDIT',
        targetMethod: '*',
        targetPath: '*',
        action: 'REQUIRE_HEADER',
        actionConfig: {},
        isActive: true
      }
    ]
  });

  console.log('Database seeded with Enterprise Policies');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
