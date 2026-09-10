import type { LinkOptions } from '@/config';
import { BaseResource } from '@/resources/base';
import type {
  ITransactionsResource,
  ListTransactionsParams,
} from '@/resources/interfaces';
import type { TransactionsPage } from '@/types/index';
import { z } from 'zod';

const transactionSchema = z.looseObject({
  id: z.string(),
  source_id: z.string().nullable(),
  amount: z.number(),
  currency: z.string(),
  created_date: z.string(),
  description: z.string(),
  origin: z.enum(['link', 'external_connection']),
  category: z.string().nullable(),
  status: z.string(),
});
const transactionsPageSchema = z.union([
  z.array(transactionSchema).transform((data) => ({ data })),
  z.looseObject({
    data: z.array(transactionSchema),
    has_more: z.boolean().optional(),
  }),
]);

export class TransactionsResource
  extends BaseResource
  implements ITransactionsResource
{
  constructor(options: LinkOptions) {
    super(options, '/transactions');
  }

  private buildUrl(params: ListTransactionsParams): string {
    const url = new URL(this.endpoint);

    if (params.limit !== undefined) {
      url.searchParams.set('limit', String(params.limit));
    }
    if (params.starting_after !== undefined) {
      url.searchParams.set('starting_after', params.starting_after);
    }
    if (params.ending_before !== undefined) {
      url.searchParams.set('ending_before', params.ending_before);
    }
    if (params.start_date !== undefined) {
      url.searchParams.set('date_start', params.start_date);
    }
    if (params.end_date !== undefined) {
      url.searchParams.set('date_end', params.end_date);
    }
    if (params.category !== undefined) {
      url.searchParams.set('category', params.category);
    }
    if (params.origin !== undefined) {
      url.searchParams.set('origin', params.origin);
    }
    if (params.sources !== undefined) {
      for (const source of params.sources) {
        url.searchParams.append('sources[]', source);
      }
    }

    return url.toString();
  }

  async list(params: ListTransactionsParams = {}): Promise<TransactionsPage> {
    const { status, data, rawBody } = await this.apiFetch({
      method: 'GET',
      url: this.buildUrl(params),
    });

    if (status < 200 || status >= 300) {
      this.throwApiError('list transactions', status, data, rawBody);
    }

    return this.parseResponse(
      'list transactions',
      status,
      () => transactionsPageSchema.parse(data) as TransactionsPage,
    );
  }
}
