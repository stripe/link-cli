import { z } from 'zod';
import type { LinkOptions } from '@/config';
import { BaseResource } from '@/resources/base';
import type {
  IHoldingsResource,
  ListHoldingsParams,
} from '@/resources/interfaces';
import type { HoldingsPage } from '@/types/index';

const holdingsPageSchema = z.looseObject({
  data: z.array(
    z.looseObject({
      id: z.string(),
      source_id: z.string(),
      description: z.string().nullable(),
      security_name: z.string().nullable(),
      total_market_value: z.record(z.string(), z.number()),
      quantity: z.number(),
      as_of_date: z.string().nullable(),
      position_type: z.string(),
      type: z.string(),
      ticker_symbol: z.string().nullable().optional(),
    }),
  ),
  has_more: z.boolean(),
});

export class HoldingsResource
  extends BaseResource
  implements IHoldingsResource
{
  constructor(options: LinkOptions) {
    super(options, '/holdings');
  }

  async list(params: ListHoldingsParams): Promise<HoldingsPage> {
    const url = new URL(this.endpoint);
    url.searchParams.set('source', params.source);
    if (params.limit !== undefined)
      url.searchParams.set('limit', String(params.limit));
    if (params.starting_after !== undefined)
      url.searchParams.set('starting_after', params.starting_after);
    if (params.ending_before !== undefined)
      url.searchParams.set('ending_before', params.ending_before);

    const { status, data, rawBody } = await this.apiFetch({
      method: 'GET',
      url: url.toString(),
    });
    if (status < 200 || status >= 300)
      this.throwApiError('list holdings', status, data, rawBody);
    return this.parseResponse(
      'list holdings',
      status,
      () => holdingsPageSchema.parse(data) as HoldingsPage,
    );
  }
}
