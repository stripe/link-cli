import {
  type LinkOptions,
  requireFetchImplementation,
  resolveLinkSdkConfig,
} from '@/config';
import { LinkApiError, LinkTransportError } from '@/errors';
import type {
  AccessTokenProvider,
  CreateSpendRequestParams,
  ISpendRequestResource,
  UpdateSpendRequestParams,
} from '@/resources/interfaces';
import type { RequestApprovalResponse, SpendRequest } from '@/types/index';

interface ApiError {
  error: { message: string; code?: string };
}

interface ApiFetchOptions {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * Normalizes `shared_payment_token` to always be an object with an `id` field.
 * The old API returned it as a plain string; the new API returns an object.
 */
function normalizeSpendRequest(data: unknown): SpendRequest {
  const sr = data as SpendRequest;
  if (typeof sr.shared_payment_token === 'string') {
    return {
      ...sr,
      shared_payment_token: { id: sr.shared_payment_token as string },
    };
  }
  return sr;
}

function extractApiError(data: unknown, rawBody: string): string {
  if (data && typeof data === 'object') {
    const body = data as Record<string, unknown>;
    if (body.error && typeof body.error === 'object') {
      const err = body.error as ApiError['error'];
      if (typeof err.message === 'string') return err.message;
    }
    if (typeof body.error === 'string') return body.error;
    if (typeof body.message === 'string') return body.message;
  }
  return rawBody || 'unknown error';
}

export class SpendRequestResource implements ISpendRequestResource {
  private readonly verbose: boolean;
  private readonly getAccessToken: AccessTokenProvider;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly spendRequestsEndpoint: string;
  private readonly logger: { debug(message: string): void };

  constructor(options: LinkOptions) {
    const config = resolveLinkSdkConfig(options);
    this.verbose = config.verbose;
    this.getAccessToken = config.getAccessToken;
    this.fetchImpl = requireFetchImplementation(config);
    this.spendRequestsEndpoint = `${config.spendRequestBaseUrl}/spend_requests`;
    this.logger = config.logger;
  }

  private async rawFetch(
    opts: ApiFetchOptions,
  ): Promise<{ status: number; data: unknown; rawBody: string }> {
    if (this.verbose) {
      const redactedHeaders = { ...opts.headers };
      if (redactedHeaders.Authorization)
        redactedHeaders.Authorization = 'Bearer <redacted>';
      this.logger.debug(`> ${opts.method} ${opts.url}`);
      this.logger.debug(`  Headers: ${JSON.stringify(redactedHeaders)}`);
      if (opts.body) this.logger.debug(opts.body);
    }

    const fetchOpts: RequestInit = {
      method: opts.method,
      headers: opts.headers,
    };

    if (opts.body) {
      fetchOpts.body = opts.body;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(opts.url, fetchOpts);
    } catch (error) {
      throw new LinkTransportError(
        `Request failed: ${opts.method} ${opts.url}`,
        {
          cause: error,
        },
      );
    }
    const rawBody = await response.text();

    let data: unknown = null;
    try {
      data = JSON.parse(rawBody);
    } catch {
      // non-JSON response (e.g., from load balancer)
    }

    if (this.verbose) {
      this.logger.debug(`< ${response.status} ${response.statusText}`);
      response.headers.forEach((value, key) => {
        this.logger.debug(`  ${key}: ${value}`);
      });
      this.logger.debug(JSON.stringify(data, null, 2) ?? rawBody);
    }

    return { status: response.status, data, rawBody };
  }

  /**
   * Authenticated fetch: injects Bearer token, retries once on 401 after
   * refreshing the token.
   */
  private async apiFetch(
    opts: ApiFetchOptions,
  ): Promise<{ status: number; data: unknown; rawBody: string }> {
    const token = await this.getAccessToken();
    const authedOpts = {
      ...opts,
      headers: { ...opts.headers, Authorization: `Bearer ${token}` },
    };

    const res = await this.rawFetch(authedOpts);

    if (res.status === 401) {
      const refreshedToken = await this.getAccessToken({ forceRefresh: true });
      authedOpts.headers.Authorization = `Bearer ${refreshedToken}`;
      return this.rawFetch(authedOpts);
    }

    return res;
  }

  create(params: CreateSpendRequestParams): Promise<SpendRequest> {
    return this.createSpendRequest(params);
  }

  async createSpendRequest(
    params: CreateSpendRequestParams,
  ): Promise<SpendRequest> {
    const { status, data, rawBody } = await this.apiFetch({
      method: 'POST',
      url: this.spendRequestsEndpoint,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (status < 200 || status >= 300) {
      throw new LinkApiError(
        `Failed to create spend request (${status}): ${extractApiError(data, rawBody)}`,
        { status, rawBody, details: data },
      );
    }

    return normalizeSpendRequest(data);
  }

  update(id: string, params: UpdateSpendRequestParams): Promise<SpendRequest> {
    return this.updateSpendRequest(id, params);
  }

  async updateSpendRequest(
    id: string,
    params: UpdateSpendRequestParams,
  ): Promise<SpendRequest> {
    const { status, data, rawBody } = await this.apiFetch({
      method: 'POST',
      url: `${this.spendRequestsEndpoint}/${id}`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (status < 200 || status >= 300) {
      throw new LinkApiError(
        `Failed to update spend request (${status}): ${extractApiError(data, rawBody)}`,
        { status, rawBody, details: data },
      );
    }

    return normalizeSpendRequest(data);
  }

  async requestApproval(id: string): Promise<RequestApprovalResponse> {
    const { status, data, rawBody } = await this.apiFetch({
      method: 'POST',
      url: `${this.spendRequestsEndpoint}/${id}/request_approval`,
    });

    if (status < 200 || status >= 300) {
      throw new LinkApiError(
        `Failed to request approval (${status}): ${extractApiError(data, rawBody)}`,
        { status, rawBody, details: data },
      );
    }

    return data as RequestApprovalResponse;
  }

  retrieve(
    id: string,
    opts?: { include?: string[] },
  ): Promise<SpendRequest | null> {
    return this.getSpendRequest(id, opts);
  }

  async getSpendRequest(
    id: string,
    opts?: { include?: string[] },
  ): Promise<SpendRequest | null> {
    const url = new URL(`${this.spendRequestsEndpoint}/${id}`);
    if (opts?.include?.length) {
      url.searchParams.set('include', opts.include.join(','));
    }

    const { status, data, rawBody } = await this.apiFetch({
      method: 'GET',
      url: url.toString(),
    });

    if (status === 404) {
      return null;
    }

    if (status < 200 || status >= 300) {
      throw new LinkApiError(
        `Failed to retrieve spend request (${status}): ${extractApiError(data, rawBody)}`,
        { status, rawBody, details: data },
      );
    }

    return normalizeSpendRequest(data);
  }
}
