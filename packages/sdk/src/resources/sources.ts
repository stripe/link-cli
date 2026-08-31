import type { LinkOptions } from '@/config';
import { BaseResource } from '@/resources/base';
import type {
  ISourcesResource,
  ListSourcesParams,
} from '@/resources/interfaces';
import type { SourcesPage } from '@/types/index';
import { z } from 'zod';

const nullableRecordSchema = z
  .record(z.string(), z.unknown())
  .nullable()
  .optional();
const sourceSchema = z.looseObject({
  id: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  capabilities: nullableRecordSchema,
  external_connection: nullableRecordSchema,
  granted_actions: z.array(z.string()).nullable().optional(),
  bank_account: nullableRecordSchema,
  card: nullableRecordSchema,
});
const sourcesPageSchema = z.looseObject({
  data: z.array(sourceSchema),
  has_more: z.boolean().optional(),
});

export class SourcesResource extends BaseResource implements ISourcesResource {
  constructor(options: LinkOptions) {
    super(options, '/sources');
  }

  private buildUrl(params: ListSourcesParams): string {
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

    return url.toString();
  }

  async list(params: ListSourcesParams = {}): Promise<SourcesPage> {
    const { status, data, rawBody } = await this.apiFetch({
      method: 'GET',
      url: this.buildUrl(params),
    });

    if (status < 200 || status >= 300) {
      this.throwApiError('list sources', status, data, rawBody);
    }

    return this.parseResponse(
      'list sources',
      status,
      () => sourcesPageSchema.parse(data) as SourcesPage,
    );
  }
}
