import { z } from 'zod';
import type { LinkOptions } from '../config.js';
import type { ApprovalPolicy } from '../types/index.js';
import { BaseResource } from './base.js';
import type { IApprovalPolicyResource } from './interfaces.js';

const approvalPolicySchema = z.looseObject({
  rules: z.array(
    z.looseObject({
      action: z.string(),
      limits: z.looseObject({
        per_purchase: z.looseObject({
          amount: z.number().int(),
          currency: z.string(),
        }),
      }),
      allowed_payment_methods: z.array(z.string()).optional(),
    }),
  ),
});

export class ApprovalPolicyResource
  extends BaseResource
  implements IApprovalPolicyResource
{
  constructor(options: LinkOptions) {
    super(options, '/approval-policy');
  }

  async retrieve(): Promise<ApprovalPolicy> {
    const { status, data, rawBody } = await this.apiFetch({
      method: 'GET',
      url: this.endpoint,
    });

    if (status < 200 || status >= 300) {
      this.throwApiError('retrieve approval policy', status, data, rawBody);
    }

    return this.parseResponse(
      'retrieve approval policy',
      status,
      () => approvalPolicySchema.parse(data) as ApprovalPolicy,
    );
  }
}
