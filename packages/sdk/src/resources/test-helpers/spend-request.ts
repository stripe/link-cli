import { z } from 'zod';
import type { LinkOptions } from '@/config';
import { BaseResource } from '@/resources/base';
import type { ITestHelpersSpendRequestResource } from '@/resources/interfaces';
import type { TestSpendRequestDecisionResponse } from '@/types/index';

const testSpendRequestDecisionResponseSchema = z.looseObject({
  id: z.string(),
  status: z.string(),
});

export class TestHelpersSpendRequestResource
  extends BaseResource
  implements ITestHelpersSpendRequestResource
{
  constructor(options: LinkOptions) {
    super(options, '/test_helpers/spend_requests', 'spend');
  }

  async approve(id: string): Promise<TestSpendRequestDecisionResponse> {
    const { status, data, rawBody } = await this.apiFetch({
      method: 'POST',
      url: `${this.endpoint}/${encodeURIComponent(id)}/approve`,
    });

    if (status < 200 || status >= 300) {
      this.throwApiError('approve test request', status, data, rawBody);
    }
    return this.parseResponse('approve test request', status, () =>
      testSpendRequestDecisionResponseSchema.parse(data),
    );
  }
}
