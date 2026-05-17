import { Controller, Post, Req, Res, BadRequestException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma.service';
import { decryptSecret } from '../crypto.util';
import { verifySlackSignature } from './slack.signature';
import { ApprovalService } from '../approval/approval.service';
import { SlackService } from './slack.service';

@Controller('slack')
@Public()
export class SlackController {
  private readonly logger = new Logger(SlackController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalService,
    private readonly slack: SlackService,
  ) {}

  // Slack POSTs application/x-www-form-urlencoded with a single field `payload`
  // containing JSON. We need the raw body for HMAC, then parse manually.
  @Post('interactions')
  async handle(@Req() req: Request, @Res() res: Response) {
    const rawBody: string | undefined = (req as any).rawBody;
    if (!rawBody) {
      throw new BadRequestException('raw body unavailable; check raw-body middleware');
    }

    const timestamp = req.headers['x-slack-request-timestamp'] as string | undefined;
    const signature = req.headers['x-slack-signature'] as string | undefined;

    const params = new URLSearchParams(rawBody);
    const payloadStr = params.get('payload');
    if (!payloadStr) throw new BadRequestException('missing payload');

    let payload: any;
    try {
      payload = JSON.parse(payloadStr);
    } catch {
      throw new BadRequestException('payload is not JSON');
    }

    const action = payload?.actions?.[0];
    const pendingId: string | undefined = action?.value;
    if (!pendingId) {
      this.logger.warn('Slack interaction missing pendingId in action.value');
      return res.status(200).send();
    }

    const pending = await this.prisma.pendingRequest.findUnique({
      where: { id: pendingId },
      select: { organizationId: true, status: true, channel: true },
    });
    if (!pending) {
      this.logger.warn(`Slack interaction for unknown pending ${pendingId}`);
      return res.status(200).send();
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: pending.organizationId },
      select: { slackSigningSecret: true, slackBotToken: true },
    });
    if (!org?.slackSigningSecret) {
      this.logger.error(`Org ${pending.organizationId} has no slackSigningSecret; cannot verify`);
      return res.status(401).send();
    }
    const secret = decryptSecret(org.slackSigningSecret);
    if (!verifySlackSignature(rawBody, timestamp, signature, secret)) {
      this.logger.warn(`Bad Slack signature for pending ${pendingId}`);
      return res.status(401).send();
    }

    const actionId: string = action.action_id;
    const userId: string = payload.user?.id ?? 'unknown';
    const userName: string = payload.user?.username ?? payload.user?.name ?? 'unknown';
    const channel = pending.channel ?? payload.channel?.id ?? '';

    // Justification comes from the plain_text_input block on the card (added in v0.2 Day 2).
    // Slack puts it under payload.state.values[block_id][action_id].value.
    const justification: string | undefined =
      payload?.state?.values?.['getmcp_justification_block']?.['getmcp_justification']?.value;

    const botToken = org.slackBotToken ? decryptSecret(org.slackBotToken) : null;

    if (actionId === 'getmcp_approve') {
      const result = await this.approvals.approveWithQuorum({
        pendingId,
        approverSlackUserId: userId,
        approverSlackUserName: userName,
        justification,
      });
      // Respond ephemerally on rejection paths so the approver sees what went wrong.
      // Slack ignores 200-with-body responses for block_actions, so we post an
      // explicit chat.postEphemeral instead.
      if (botToken && channel) {
        if (result.kind === 'rejected_missing_justification') {
          await this.slack.postEphemeral(botToken, channel, userId,
            ':warning: This rule requires a justification. Type a one-line reason in the field before clicking Approve.');
        } else if (result.kind === 'already_voted') {
          await this.slack.postEphemeral(botToken, channel, userId,
            `:white_check_mark: Your vote was already recorded (${result.have} of ${result.need} approvers).`);
        } else if (result.kind === 'pending_quorum') {
          await this.slack.postEphemeral(botToken, channel, userId,
            `:hourglass: Vote recorded (${result.have} of ${result.need} approvers). Waiting for the rest.`);
        }
      }
      return res.status(200).json({ ok: true, kind: result.kind });
    }
    if (actionId === 'getmcp_deny') {
      const result = await this.approvals.deny(
        { pendingId, approverSlackUserId: userId, approverSlackUserName: userName },
        justification,
      );
      return res.status(200).json({ ok: true, decision: result?.status ?? 'NOOP' });
    }

    this.logger.warn(`Unknown action_id ${actionId}`);
    return res.status(200).send();
  }
}
