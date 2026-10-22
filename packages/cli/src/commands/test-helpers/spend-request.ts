import { BaseResource, type LinkOptions } from '@stripe/link-sdk';
import { z } from 'zod';

export interface TestSpendRequestDecisionResponse {
  id: string;
  status: string;
}

export interface ITestHelpersSpendRequestResource {
  approve(id: string): Promise<TestSpendRequestDecisionResponse>;
}

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
