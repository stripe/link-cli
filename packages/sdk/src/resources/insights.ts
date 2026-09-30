import { z } from 'zod';
import type { LinkOptions } from '@/config';
import { BaseResource } from '@/resources/base';
import type {
  IInsightsResource,
  ListInsightsParams,
  ListInsightTypesParams,
} from '@/resources/interfaces';
import type { AvailableInsightTypesPage, InsightsPage } from '@/types/index';

const authorizationRemediationSchema = z.looseObject({
  scope: z.array(z.string()).optional(),
  authorization_details: z
    .array(z.looseObject({ type: z.string(), actions: z.array(z.string()) }))
    .optional(),
});

const availableInsightTypesPageSchema = z.looseObject({
  data: z.array(
    z.looseObject({
      id: z.string(),
      description: z.string(),
      authorization_remediation: authorizationRemediationSchema
        .nullable()
        .optional(),
    }),
  ),
  has_more: z.boolean(),
});

const insightsPageSchema = z.looseObject({
  data: z.array(
    z.looseObject({
      id: z.string(),
      description: z.string(),
      status: z.string(),
      as_of: z.number().nullable().optional(),
      data: z
        .array(z.looseObject({ label: z.string(), value: z.unknown() }))
        .nullable()
        .optional(),
      error_code: z.string().nullable().optional(),
      error_message: z.string().nullable().optional(),
      authorization_remediation: authorizationRemediationSchema
        .nullable()
        .optional(),
    }),
  ),
  has_more: z.boolean(),
});

export class InsightsResource
  extends BaseResource
  implements IInsightsResource
{
  constructor(options: LinkOptions) {
    super(options, '/insights');
  }

  async listAvailableTypes(
    params: ListInsightTypesParams = {},
  ): Promise<AvailableInsightTypesPage> {
    const url = new URL(`${this.endpoint}/available_types`);
    if (params.limit !== undefined)
      url.searchParams.set('limit', String(params.limit));
    if (params.starting_after !== undefined)
      url.searchParams.set('starting_after', params.starting_after);

    const { status, data, rawBody } = await this.apiFetch({
      method: 'GET',
      url: url.toString(),
    });
    if (status < 200 || status >= 300)
      this.throwApiError('list available insight types', status, data, rawBody);
    return this.parseResponse(
      'list available insight types',
      status,
      () =>
        availableInsightTypesPageSchema.parse(
          data,
        ) as AvailableInsightTypesPage,
    );
  }

  async list(params: ListInsightsParams = {}): Promise<InsightsPage> {
    const url = new URL(this.endpoint);
    if (params.limit !== undefined)
      url.searchParams.set('limit', String(params.limit));
    if (params.starting_after !== undefined)
      url.searchParams.set('starting_after', params.starting_after);
    if (params.insights !== undefined)
      for (const insight of params.insights)
        url.searchParams.append('insights[]', insight);

    const { status, data, rawBody } = await this.apiFetch({
      method: 'GET',
      url: url.toString(),
    });
    if (status < 200 || status >= 300)
      this.throwApiError('list insights', status, data, rawBody);
    return this.parseResponse(
      'list insights',
      status,
      () => insightsPageSchema.parse(data) as InsightsPage,
    );
  }
}
