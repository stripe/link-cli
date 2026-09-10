import type { LinkOptions } from '@/config';
import { BaseResource } from '@/resources/base';
import type {
  IBalancesResource,
  ListBalancesParams,
} from '@/resources/interfaces';
import type { BalancesPage } from '@/types/index';
import { z } from 'zod';

const currencyAmountsSchema = z.record(z.string(), z.number());
const balanceSchema = z.looseObject({
  source_id: z.string(),
  type: z.enum(['cash', 'credit']),
  cash: z
    .looseObject({ available: currencyAmountsSchema })
    .nullable()
    .optional(),
  credit: z.looseObject({ used: currencyAmountsSchema }).nullable().optional(),
  current: z.number(),
  currency: z.string(),
  as_of: z.string(),
});
const balancesPageSchema = z.looseObject({
  data: z.array(balanceSchema),
  has_more: z.boolean().optional(),
});

export class BalancesResource
  extends BaseResource
  implements IBalancesResource
{
  constructor(options: LinkOptions) {
    super(options, '/balances');
  }

  private buildUrl(params: ListBalancesParams): string {
    const url = new URL(this.endpoint);

    if (params.sources !== undefined) {
      for (const source of params.sources) {
        url.searchParams.append('sources[]', source);
      }
    }
    if (params.limit !== undefined) {
      url.searchParams.set('limit', String(params.limit));
    }
    if (params.starting_after !== undefined) {
      url.searchParams.set('starting_after', params.starting_after);
    }
    if (params.ending_before !== undefined) {
      url.searchParams.set('ending_before', params.ending_before);
    }

    return url.toString();
  }

  async list(params: ListBalancesParams = {}): Promise<BalancesPage> {
    const { status, data, rawBody } = await this.apiFetch({
      method: 'GET',
      url: this.buildUrl(params),
    });

    if (status < 200 || status >= 300) {
      this.throwApiError('list balances', status, data, rawBody);
    }

    return this.parseResponse(
      'list balances',
      status,
      () => balancesPageSchema.parse(data) as BalancesPage,
    );
  }
}
