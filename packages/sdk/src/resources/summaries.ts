import { z } from 'zod';
import type { LinkOptions } from '@/config';
import { BaseResource } from '@/resources/base';
import type {
  ISummariesResource,
  ListSummariesParams,
} from '@/resources/interfaces';
import type { SummariesPage } from '@/types/index';

const summaryValueSchema = z.discriminatedUnion('unit', [
  z.looseObject({ unit: z.literal('count'), count: z.number() }),
  z.looseObject({
    unit: z.literal('payment_volume'),
    amount: z.number(),
    currency: z.string(),
  }),
]);
const summaryDataValueSchema = z.discriminatedUnion('unit', [
  z.looseObject({ unit: z.literal('count'), amount: z.number() }),
  z.looseObject({
    unit: z.literal('payment_volume'),
    amount: z.number(),
    currency: z.string(),
  }),
]);
const summarySchema = z.looseObject({
  id: z.string(),
  description: z.string(),
  created_at: z.string().nullable().optional(),
  status: z.enum(['ready', 'pending', 'no_data']),
  entries: z
    .array(z.looseObject({ label: z.string(), value: summaryValueSchema }))
    .default([]),
  as_of: z.number().optional(),
  data: z
    .array(z.looseObject({ label: z.string(), value: summaryDataValueSchema }))
    .nullable()
    .optional(),
});
const summariesPageSchema = z.looseObject({
  data: z.array(summarySchema),
  has_more: z.boolean().optional(),
});

export class SummariesResource
  extends BaseResource
  implements ISummariesResource
{
  constructor(options: LinkOptions) {
    super(options, '/summaries');
  }

  private buildUrl(params: ListSummariesParams): string {
    const url = new URL(this.endpoint);
    if (params.starting_after !== undefined)
      url.searchParams.set('starting_after', params.starting_after);
    if (params.summaries !== undefined)
      for (const summary of params.summaries)
        url.searchParams.append('summaries[]', summary);
    return url.toString();
  }

  async list(params: ListSummariesParams = {}): Promise<SummariesPage> {
    const { status, data, rawBody } = await this.apiFetch({
      method: 'GET',
      url: this.buildUrl(params),
    });
    if (status < 200 || status >= 300)
      this.throwApiError('list summaries', status, data, rawBody);
    return this.parseResponse(
      'list summaries',
      status,
      () => summariesPageSchema.parse(data) as SummariesPage,
    );
  }
}
