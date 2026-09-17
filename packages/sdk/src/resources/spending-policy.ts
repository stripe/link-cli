import { z } from 'zod';
import type { LinkOptions } from '@/config';
import { BaseResource } from '@/resources/base';
import type { ISpendingPolicyResource } from '@/resources/interfaces';
import type { SpendingPolicy } from '@/types/index';

const spendingPolicySchema = z.looseObject({
  rules: z.array(
    z.looseObject({
      action: z.string(),
      approval_type: z.string().optional(),
      limits: z
        .looseObject({
          per_purchase: z.looseObject({
            amount: z.number().int(),
            currency: z.string(),
          }),
        })
        .optional(),
      allowed_payment_methods: z.array(z.string()).optional(),
    }),
  ),
});

export class SpendingPolicyResource
  extends BaseResource
  implements ISpendingPolicyResource
{
  constructor(options: LinkOptions) {
    super(options, '/spending-policy');
  }

  async retrieve(): Promise<SpendingPolicy> {
    const { status, data, rawBody } = await this.apiFetch({
      method: 'GET',
      url: this.endpoint,
    });

    if (status < 200 || status >= 300) {
      this.throwApiError('retrieve spending policy', status, data, rawBody);
    }

    return this.parseResponse(
      'retrieve spending policy',
      status,
      () => spendingPolicySchema.parse(data) as SpendingPolicy,
    );
  }
}
