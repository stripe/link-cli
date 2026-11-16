import { z } from 'zod';
import type { LinkOptions } from '@/config';
import { BaseResource } from '@/resources/base';
import type {
  ITaxLotsResource,
  ListTaxLotsParams,
} from '@/resources/interfaces';
import type { TaxLotsPage } from '@/types/index';

const taxLotsPageSchema = z.looseObject({
  data: z.array(
    z.looseObject({
      id: z.string(),
      purchased_date: z.string(),
      cost_basis: z.number().nullable(),
      quantity: z.number(),
    }),
  ),
  has_more: z.boolean(),
});

export class TaxLotsResource extends BaseResource implements ITaxLotsResource {
  constructor(options: LinkOptions) {
    super(options, '/tax_lots');
  }

  async list(params: ListTaxLotsParams): Promise<TaxLotsPage> {
    const url = new URL(this.endpoint);
    url.searchParams.set('holding', params.holding);
    if (params.limit !== undefined)
      url.searchParams.set('limit', String(params.limit));
    if (params.starting_after !== undefined)
      url.searchParams.set('starting_after', params.starting_after);
    if (params.ending_before !== undefined)
      url.searchParams.set('ending_before', params.ending_before);
    if (params.start_date !== undefined)
      url.searchParams.set('start_date', params.start_date);
    if (params.end_date !== undefined)
      url.searchParams.set('end_date', params.end_date);

    const { status, data, rawBody } = await this.apiFetch({
      method: 'GET',
      url: url.toString(),
    });
    if (status < 200 || status >= 300)
      this.throwApiError('list tax lots', status, data, rawBody);
    return this.parseResponse(
      'list tax lots',
      status,
      () => taxLotsPageSchema.parse(data) as TaxLotsPage,
    );
  }
}
