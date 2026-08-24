import type { LinkOptions } from '@/config';
import { LinkApiError } from '@/errors';
import { BaseResource } from '@/resources/base';
import type {
  CreateSpendRequestParams,
  ISpendRequestResource,
  UpdateSpendRequestParams,
} from '@/resources/interfaces';
import type { RequestApprovalResponse, SpendRequest } from '@/types/index';
import { z } from 'zod';

const sharedPaymentTokenSchema = z.union([
  z.string().transform((id) => ({ id })),
  z.looseObject({ id: z.string() }),
]);

const spendRequestSchema = z.looseObject({
  id: z.string(),
  payment_details: z.string().optional(),
  status: z.string(),
  line_items: z.array(z.unknown()).optional(),
  totals: z.array(z.unknown()).optional(),
  created_at: z.string(),
  updated_at: z.string(),
  shared_payment_token: sharedPaymentTokenSchema.nullable().optional(),
});

const spendRequestsResponseSchema = z.looseObject({
  data: z.array(spendRequestSchema),
});

const requestApprovalResponseSchema = z
  .looseObject({
    id: z.string(),
    approval_link: z.string(),
  })
  .transform(({ approval_link, ...response }) => ({
    ...response,
    approval_url: approval_link,
  }));

const duplicateSpendRequestErrorSchema = z.looseObject({
  error: z.looseObject({
    duplicate_spend_request: z.unknown().optional(),
  }),
});

type InternalCreateSpendRequestParams = CreateSpendRequestParams & {
  approve?: boolean;
  expires_at?: number;
};

/** Normalizes the legacy string SPT response into the current object shape. */
function parseSpendRequest(value: unknown): SpendRequest {
  return spendRequestSchema.parse(value) as SpendRequest;
}

export function getDuplicateSpendRequest(error: unknown): SpendRequest | null {
  if (!(error instanceof LinkApiError)) return null;
  const details = duplicateSpendRequestErrorSchema.safeParse(error.details);
  if (!details.success) return null;

  const duplicate = spendRequestSchema.safeParse(
    details.data.error.duplicate_spend_request,
  );
  return duplicate.success ? (duplicate.data as SpendRequest) : null;
}

export class SpendRequestResource
  extends BaseResource
  implements ISpendRequestResource
{
  constructor(options: LinkOptions) {
    super(options, '/spend_requests', 'spend');
  }

  async list(opts?: { includeHistory?: boolean }): Promise<SpendRequest[]> {
    const url = opts?.includeHistory
      ? `${this.endpoint}?include_history=true`
      : this.endpoint;
    const { status, data, rawBody } = await this.apiFetch({
      method: 'GET',
      url,
    });

    if (status < 200 || status >= 300) {
      this.throwApiError('list spend requests', status, data, rawBody);
    }

    return this.parseResponse(
      'list spend requests',
      status,
      () => spendRequestsResponseSchema.parse(data).data as SpendRequest[],
    );
  }

  async create(
    params: InternalCreateSpendRequestParams,
  ): Promise<SpendRequest> {
    const { approve, ...body } = params;
    const url = approve ? `${this.endpoint}/create_delegated` : this.endpoint;
    const { status, data, rawBody } = await this.apiFetch({
      method: 'POST',
      url,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (status < 200 || status >= 300) {
      this.throwApiError('create spend request', status, data, rawBody);
    }
    return this.parseResponse('create spend request', status, () =>
      parseSpendRequest(data),
    );
  }

  async update(
    id: string,
    params: UpdateSpendRequestParams,
  ): Promise<SpendRequest> {
    const { status, data, rawBody } = await this.apiFetch({
      method: 'POST',
      url: `${this.endpoint}/${id}`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (status < 200 || status >= 300) {
      this.throwApiError('update spend request', status, data, rawBody);
    }
    return this.parseResponse('update spend request', status, () =>
      parseSpendRequest(data),
    );
  }

  async cancel(id: string): Promise<SpendRequest> {
    const { status, data, rawBody } = await this.apiFetch({
      method: 'POST',
      url: `${this.endpoint}/${id}/cancel`,
    });

    if (status < 200 || status >= 300) {
      this.throwApiError('cancel spend request', status, data, rawBody);
    }
    return this.parseResponse('cancel spend request', status, () =>
      parseSpendRequest(data),
    );
  }

  async requestApproval(id: string): Promise<RequestApprovalResponse> {
    const { status, data, rawBody } = await this.apiFetch({
      method: 'POST',
      url: `${this.endpoint}/${id}/request_approval`,
    });

    if (status < 200 || status >= 300) {
      this.throwApiError('request approval', status, data, rawBody);
    }
    return this.parseResponse('request approval', status, () =>
      requestApprovalResponseSchema.parse(data),
    );
  }

  async retrieve(
    id: string,
    opts?: { include?: string[] },
  ): Promise<SpendRequest | null> {
    const url = new URL(`${this.endpoint}/${id}`);
    if (opts?.include?.length) {
      url.searchParams.set('include', opts.include.join(','));
    }
    const { status, data, rawBody } = await this.apiFetch({
      method: 'GET',
      url: url.toString(),
    });

    if (status === 404) return null;
    if (status < 200 || status >= 300) {
      this.throwApiError('retrieve spend request', status, data, rawBody);
    }
    return this.parseResponse('retrieve spend request', status, () =>
      parseSpendRequest(data),
    );
  }
}
