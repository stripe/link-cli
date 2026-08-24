import type { LinkOptions } from '@/config';
import { LinkApiError } from '@/errors';
import {
  BaseResource,
  requireArray,
  requireRecord,
  requireString,
} from '@/resources/base';
import type {
  CreateSpendRequestParams,
  ISpendRequestResource,
  UpdateSpendRequestParams,
} from '@/resources/interfaces';
import type {
  RequestApprovalResponse,
  SpendRequest,
  SpendRequestStatus,
} from '@/types/index';

const SPEND_REQUEST_STATUSES = new Set<SpendRequestStatus>([
  'created',
  'pending_approval',
  'expired',
  'approved',
  'denied',
  'succeeded',
  'failed',
  'canceled',
  'requires_action',
]);

type InternalCreateSpendRequestParams = CreateSpendRequestParams & {
  approve?: boolean;
  expires_at?: number;
};

function requireSpendRequestStatus(
  value: unknown,
  field: string,
): SpendRequestStatus {
  const status = requireString(value, field) as SpendRequestStatus;
  if (!SPEND_REQUEST_STATUSES.has(status)) {
    throw new TypeError(`Expected ${field} to be a known spend request status`);
  }
  return status;
}

/** Normalizes the legacy string SPT response into the current object shape. */
function parseSpendRequest(value: unknown): SpendRequest {
  const body = requireRecord(value);
  const sharedPaymentToken = body.shared_payment_token;
  const normalizedSharedPaymentToken =
    typeof sharedPaymentToken === 'string'
      ? { id: sharedPaymentToken }
      : sharedPaymentToken;
  if (normalizedSharedPaymentToken !== undefined) {
    const token = requireRecord(
      normalizedSharedPaymentToken,
      'shared_payment_token',
    );
    requireString(token.id, 'shared_payment_token.id');
  }

  requireArray(body.line_items, 'line_items');
  requireArray(body.totals, 'totals');

  return {
    ...body,
    id: requireString(body.id, 'id'),
    payment_details: requireString(body.payment_details, 'payment_details'),
    status: requireSpendRequestStatus(body.status, 'status'),
    line_items: body.line_items as SpendRequest['line_items'],
    totals: body.totals as SpendRequest['totals'],
    created_at: requireString(body.created_at, 'created_at'),
    updated_at: requireString(body.updated_at, 'updated_at'),
    ...(normalizedSharedPaymentToken !== undefined && {
      shared_payment_token:
        normalizedSharedPaymentToken as SpendRequest['shared_payment_token'],
    }),
  } as SpendRequest;
}

export function getDuplicateSpendRequest(error: unknown): SpendRequest | null {
  if (!(error instanceof LinkApiError)) return null;
  const details = error.details;
  if (!details || typeof details !== 'object') return null;
  const errorBody = (details as Record<string, unknown>).error;
  if (!errorBody || typeof errorBody !== 'object') return null;
  const duplicate = (errorBody as Record<string, unknown>)
    .duplicate_spend_request;
  try {
    return duplicate === undefined ? null : parseSpendRequest(duplicate);
  } catch {
    return null;
  }
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

    return this.parseResponse('list spend requests', status, () => {
      const body = requireRecord(data);
      return requireArray(body.data, 'data').map(parseSpendRequest);
    });
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
    return this.parseResponse('request approval', status, () => {
      const body = requireRecord(data);
      return {
        id: requireString(body.id, 'id'),
        approval_link: requireString(body.approval_link, 'approval_link'),
      };
    });
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
