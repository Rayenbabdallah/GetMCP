import { Controller, Get, Param } from '@nestjs/common';
import { ApprovalService } from './approval.service';
import { CurrentOrg, AuthContext } from '../auth/current-org.decorator';

@Controller('approvals')
export class ApprovalController {
  constructor(private readonly approvals: ApprovalService) {}

  // Caller of /proxy/execute polls this endpoint until status leaves PENDING.
  // When status === 'APPROVED', responseStatus / responseHeaders / responseBody
  // contain the captured upstream response.
  @Get(':id')
  async get(@CurrentOrg() org: AuthContext, @Param('id') id: string) {
    return this.approvals.getById(org.organizationId, id);
  }
}
