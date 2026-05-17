import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export interface SlackMessageRef {
  channel: string;
  ts: string;
}

export interface ApprovalMessageInput {
  pendingId: string;
  agentName: string;
  source: string;
  tenantId: string | null;
  method: string;
  path: string;
  reasoning: string | null;
  ruleName: string;
  expiresAt: Date;
  // Drives the card's UX: render the justification input if required, show
  // quorum progress when N > 1. Defaults: false / 1 (single approver, no
  // justification) for backwards compatibility.
  requireJustification?: boolean;
  quorumRequired?: number;
  quorumHave?: number;
}

@Injectable()
export class SlackService {
  private readonly logger = new Logger(SlackService.name);

  // Posts an interactive approval card. Returns the channel + ts so we can
  // chat.update the same message after the decision.
  async postApprovalMessage(
    botToken: string,
    channel: string,
    input: ApprovalMessageInput,
  ): Promise<SlackMessageRef> {
    const blocks = this.buildApprovalBlocks(input);

    const resp = await axios.post(
      'https://slack.com/api/chat.postMessage',
      {
        channel,
        text: `Approval needed: ${input.method} ${input.path}`,
        blocks,
      },
      {
        headers: {
          Authorization: `Bearer ${botToken}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        timeout: 5000,
      },
    );

    if (!resp.data?.ok) {
      throw new Error(`Slack chat.postMessage failed: ${resp.data?.error || 'unknown'}`);
    }
    return { channel: resp.data.channel, ts: resp.data.ts };
  }

  async updateMessageDecision(
    botToken: string,
    ref: SlackMessageRef,
    input: ApprovalMessageInput,
    decision: 'APPROVED' | 'DENIED' | 'EXPIRED',
    actor?: string,
  ): Promise<void> {
    const blocks = this.buildDecidedBlocks(input, decision, actor);
    const resp = await axios.post(
      'https://slack.com/api/chat.update',
      {
        channel: ref.channel,
        ts: ref.ts,
        text: `${decision}: ${input.method} ${input.path}`,
        blocks,
      },
      {
        headers: {
          Authorization: `Bearer ${botToken}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        timeout: 5000,
      },
    );
    if (!resp.data?.ok) {
      this.logger.warn(`chat.update failed: ${resp.data?.error || 'unknown'}`);
    }
  }

  buildApprovalBlocks(i: ApprovalMessageInput) {
    const ttlSec = Math.max(0, Math.floor((i.expiresAt.getTime() - Date.now()) / 1000));
    const quorum = Math.max(1, i.quorumRequired ?? 1);
    const have = Math.max(0, i.quorumHave ?? 0);
    const requireJustification = Boolean(i.requireJustification);

    const blocks: any[] = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `:lock: Approval needed — ${i.method} ${i.path}` },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Agent*\n${i.agentName} (${i.source})` },
          { type: 'mrkdwn', text: `*Tenant*\n${i.tenantId || '—'}` },
          { type: 'mrkdwn', text: `*Rule*\n${i.ruleName}` },
          { type: 'mrkdwn', text: `*Expires in*\n${ttlSec}s` },
        ],
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Reasoning*\n${i.reasoning || '_(none provided)_'}` },
      },
    ];

    // Quorum progress, only when N > 1 — otherwise it's noise.
    if (quorum > 1) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `:busts_in_silhouette: *Quorum:* ${have} of ${quorum} approvers`,
          },
        ],
      });
    }

    // Justification input — always visible when required, optional otherwise.
    // We render it as optional (no `*` from Slack) but the backend enforces it
    // and returns an ephemeral error if missing when the rule requires it.
    if (requireJustification) {
      blocks.push({
        type: 'input',
        block_id: 'getmcp_justification_block',
        label: { type: 'plain_text', text: 'Justification (required)' },
        element: {
          type: 'plain_text_input',
          action_id: 'getmcp_justification',
          placeholder: { type: 'plain_text', text: 'Why are you approving this?' },
          max_length: 500,
        },
        optional: false,
      });
    }

    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Approve' },
          style: 'primary',
          value: i.pendingId,
          action_id: 'getmcp_approve',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Deny' },
          style: 'danger',
          value: i.pendingId,
          action_id: 'getmcp_deny',
        },
      ],
    });

    return blocks;
  }

  // Posts a private "only-you-can-see-this" message back to the approver — used
  // when their click is rejected (missing justification, already voted, etc.).
  async postEphemeral(
    botToken: string,
    channel: string,
    userId: string,
    text: string,
  ): Promise<void> {
    try {
      await axios.post(
        'https://slack.com/api/chat.postEphemeral',
        { channel, user: userId, text },
        {
          headers: {
            Authorization: `Bearer ${botToken}`,
            'Content-Type': 'application/json; charset=utf-8',
          },
          timeout: 5000,
        },
      );
    } catch (err: any) {
      this.logger.warn(`postEphemeral failed: ${err.message}`);
    }
  }

  buildDecidedBlocks(i: ApprovalMessageInput, decision: string, actor?: string) {
    const verb = decision === 'APPROVED' ? ':white_check_mark: Approved' : decision === 'DENIED' ? ':no_entry: Denied' : ':alarm_clock: Expired';
    const by = actor ? ` by <@${actor}>` : '';
    return [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${verb} — ${i.method} ${i.path}` },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Agent*\n${i.agentName} (${i.source})` },
          { type: 'mrkdwn', text: `*Decision*${by}\n${decision}` },
          { type: 'mrkdwn', text: `*Rule*\n${i.ruleName}` },
        ],
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Reasoning*\n${i.reasoning || '_(none provided)_'}` },
      },
    ];
  }
}
