import { Controller, Post, Req, Res, BadRequestException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma.service';
import { decryptSecret } from '../crypto.util';
import { verifySlackSignature } from './slack.signature';
import { ApprovalService } from '../approval/approval.service';

@Controller('slack')
@Public()
export class SlackController {
  private readonly logger = new Logger(SlackController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalService,
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

    // Decode payload first to learn which org this belongs to (we need the org
    // to know which signing secret to verify against). We do NOT trust anything
    // out of the payload until after verification — we only use it to look up
    // the secret.
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
      select: { organizationId: true, status: true },
    });
    if (!pending) {
      this.logger.warn(`Slack interaction for unknown pending ${pendingId}`);
      return res.status(200).send();
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: pending.organizationId },
      select: { slackSigningSecret: true },
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
    const actor = {
      pendingId,
      approverSlackUserId: payload.user?.id ?? 'unknown',
      approverSlackUserName: payload.user?.username ?? payload.user?.name ?? 'unknown',
    };

    if (actionId === 'getmcp_approve') {
      const result = await this.approvals.approve(actor);
      return res.status(200).json({ ok: true, decision: result?.status ?? 'NOOP' });
    }
    if (actionId === 'getmcp_deny') {
      const result = await this.approvals.deny(actor);
      return res.status(200).json({ ok: true, decision: result?.status ?? 'NOOP' });
    }

    this.logger.warn(`Unknown action_id ${actionId}`);
    return res.status(200).send();
  }
}
