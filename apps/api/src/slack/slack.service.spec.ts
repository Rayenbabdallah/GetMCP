import { SlackService, ApprovalMessageInput } from './slack.service';

function baseInput(over: Partial<ApprovalMessageInput> = {}): ApprovalMessageInput {
  return {
    pendingId: 'pend-1',
    agentName: 'agent-1',
    source: 'external_mcp',
    tenantId: 'tenant-42',
    method: 'POST',
    path: '/v1/refunds',
    reasoning: 'customer requested rollback per CS-321',
    ruleName: 'refund-approval',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    ...over,
  };
}

describe('SlackService.buildApprovalBlocks', () => {
  const svc = new SlackService();

  it('renders the baseline card — no justification input, no quorum context', () => {
    const blocks = svc.buildApprovalBlocks(baseInput());
    const justification = blocks.find((b: any) => b.block_id === 'getmcp_justification_block');
    const quorumContext = blocks.find(
      (b: any) => b.type === 'context' && (b.elements?.[0]?.text ?? '').includes('Quorum'),
    );
    expect(justification).toBeUndefined();
    expect(quorumContext).toBeUndefined();
    // Approve + Deny actions are always present.
    const actions = blocks.find((b: any) => b.type === 'actions');
    expect(actions.elements.map((e: any) => e.action_id).sort()).toEqual(['getmcp_approve', 'getmcp_deny']);
  });

  it('renders the justification input when requireJustification: true', () => {
    const blocks = svc.buildApprovalBlocks(baseInput({ requireJustification: true }));
    const input = blocks.find((b: any) => b.block_id === 'getmcp_justification_block');
    expect(input).toBeDefined();
    expect(input.optional).toBe(false);
    expect(input.element.action_id).toBe('getmcp_justification');
    expect(input.element.type).toBe('plain_text_input');
  });

  it('renders the quorum context only when quorumRequired > 1', () => {
    const single = svc.buildApprovalBlocks(baseInput({ quorumRequired: 1, quorumHave: 0 }));
    const multi = svc.buildApprovalBlocks(baseInput({ quorumRequired: 3, quorumHave: 1 }));

    const singleCtx = single.find((b: any) => b.type === 'context');
    const multiCtx = multi.find((b: any) => b.type === 'context');

    expect(singleCtx).toBeUndefined();
    expect(multiCtx).toBeDefined();
    expect(multiCtx.elements[0].text).toMatch(/1 of 3 approvers/);
  });

  it('justification input + quorum context render together when both are configured', () => {
    const blocks = svc.buildApprovalBlocks(
      baseInput({ requireJustification: true, quorumRequired: 2, quorumHave: 0 }),
    );
    const input = blocks.find((b: any) => b.block_id === 'getmcp_justification_block');
    const ctx = blocks.find((b: any) => b.type === 'context');
    expect(input).toBeDefined();
    expect(ctx).toBeDefined();
    // Order matters in Slack — input must come before the actions block.
    const inputIdx = blocks.indexOf(input);
    const actionsIdx = blocks.findIndex((b: any) => b.type === 'actions');
    expect(inputIdx).toBeLessThan(actionsIdx);
  });

  it('renders recent activity context when supplied', () => {
    const now = Date.now();
    const blocks = svc.buildApprovalBlocks(baseInput({
      recentActivity: [
        { method: 'GET',    path: '/v1/charges',        actionTaken: 'EXECUTED',          timestamp: new Date(now - 30_000) },
        { method: 'POST',   path: '/v1/refunds',        actionTaken: 'AWAITING_APPROVAL', timestamp: new Date(now - 300_000) },
        { method: 'DELETE', path: '/v1/customers/abc',  actionTaken: 'BLOCKED',           timestamp: new Date(now - 3_600_000 * 2) },
      ],
    }));
    const activity = blocks.find((b: any) =>
      b.type === 'section' && (b.text?.text ?? '').includes('Recent activity from this agent'),
    );
    expect(activity).toBeDefined();
    expect(activity.text.text).toContain('GET');
    expect(activity.text.text).toContain('/v1/charges');
    expect(activity.text.text).toContain('just now');
    expect(activity.text.text).toContain('5m ago');
    expect(activity.text.text).toContain('2h ago');
  });

  it('skips recent-activity block when array is empty', () => {
    const blocks = svc.buildApprovalBlocks(baseInput({ recentActivity: [] }));
    const activity = blocks.find((b: any) =>
      b.type === 'section' && (b.text?.text ?? '').includes('Recent activity'),
    );
    expect(activity).toBeUndefined();
  });
});
