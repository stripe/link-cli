import {
  type LinkOptions,
  requireFetchImplementation,
  resolveLinkSdkConfig,
} from '@/config';
import { LinkApiError, LinkTransportError } from '@/errors';
import type {
  AccessTokenProvider,
  CompleteUcpCheckoutParams,
  CreateUcpCheckoutParams,
  IUcpResource,
  RetrieveUcpCheckoutParams,
  SearchUcpCatalogParams,
} from '@/resources/interfaces';
import type {
  UcpCheckout,
  UcpCheckoutWithSpendRequest,
  UcpProduct,
  UcpSearchResult,
} from '@/types/index';

interface ApiFetchOptions {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

function extractApiError(data: unknown, rawBody: string): string {
  if (data && typeof data === 'object') {
    const body = data as Record<string, unknown>;
    if (body.error && typeof body.error === 'object') {
      const err = body.error as { message?: string; code?: string };
      if (typeof err.message === 'string') return err.message;
    }
    if (typeof body.error === 'string') return body.error;
    if (typeof body.message === 'string') return body.message;
  }
  return rawBody || 'unknown error';
}

function normalizeSearchResult(data: unknown): UcpSearchResult {
  const body = (data ?? {}) as Record<string, unknown>;
  const items = Array.isArray(body.data) ? (body.data as UcpProduct[]) : [];
  return { ...body, data: items } as UcpSearchResult;
}

function normalizeCheckout(data: unknown): UcpCheckout {
  const body = (data ?? {}) as Record<string, unknown>;
  return { ...body, id: String(body.id ?? '') } as UcpCheckout;
}

/**
 * UCP (Universal Commerce Protocol) endpoints on api.link.com — gated proxies
 * over the Delegated Checkout / Commerce APIs. Every endpoint accepts `test`,
 * which routes to a self-contained demo response upstream (no live checkout).
 */
export class UcpResource implements IUcpResource {
  private readonly verbose: boolean;
  private readonly getAccessToken: AccessTokenProvider;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly ucpEndpoint: string;
  private readonly logger: { debug(message: string): void };

  constructor(options: LinkOptions) {
    const config = resolveLinkSdkConfig(options);
    this.verbose = config.verbose;
    this.getAccessToken = config.getAccessToken;
    this.fetchImpl = requireFetchImplementation(config);
    this.ucpEndpoint = `${config.apiBaseUrl}/ucp`;
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
      ...(opts.headers ? { headers: opts.headers } : {}),
    };
    if (opts.body) fetchOpts.body = opts.body;

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

  /** Injects the Bearer token; retries once on 401 after refreshing. */
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

  private buildSearchUrl(params: SearchUcpCatalogParams): string {
    const url = new URL(`${this.ucpEndpoint}/catalog/search`);
    const setIf = (key: string, value: string | number | undefined) => {
      if (value !== undefined) url.searchParams.set(key, String(value));
    };
    setIf('query', params.query);
    setIf('profile_id', params.profile_id);
    setIf('sku', params.sku);
    setIf('price_min', params.price_min);
    setIf('price_max', params.price_max);
    setIf('currency', params.currency);
    setIf('availability', params.availability);
    setIf('sort', params.sort);
    setIf('group_by', params.group_by);
    setIf('limit', params.limit);
    setIf('offset', params.offset);
    if (params.include_facets) url.searchParams.set('include_facets', 'true');

    const arrays: Array<[string, string[] | undefined]> = [
      ['brand', params.brand],
      ['category', params.category],
      ['color', params.color],
      ['size', params.size],
      ['material', params.material],
      ['gender', params.gender],
      ['condition', params.condition],
    ];
    for (const [key, values] of arrays) {
      if (values)
        for (const value of values) url.searchParams.append(`${key}[]`, value);
    }

    if (params.test) url.searchParams.set('test', 'true');
    return url.toString();
  }

  async searchCatalog(
    params: SearchUcpCatalogParams,
  ): Promise<UcpSearchResult> {
    const { status, data, rawBody } = await this.apiFetch({
      method: 'GET',
      url: this.buildSearchUrl(params),
    });

    if (status < 200 || status >= 300) {
      throw new LinkApiError(
        `Failed to search UCP catalog (${status}): ${extractApiError(data, rawBody)}`,
        { status, rawBody, details: data },
      );
    }

    return normalizeSearchResult(data);
  }

  async createCheckout(params: CreateUcpCheckoutParams): Promise<UcpCheckout> {
    const body: Record<string, unknown> = {
      profile_id: params.profile_id,
      line_items: params.line_items,
    };
    if (params.currency !== undefined) body.currency = params.currency;
    if (params.fulfillment_details !== undefined)
      body.fulfillment_details = params.fulfillment_details;
    if (params.test) body.test = true;

    const { status, data, rawBody } = await this.apiFetch({
      method: 'POST',
      url: `${this.ucpEndpoint}/checkout`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (status < 200 || status >= 300) {
      throw new LinkApiError(
        `Failed to create UCP checkout (${status}): ${extractApiError(data, rawBody)}`,
        { status, rawBody, details: data },
      );
    }

    return normalizeCheckout(data);
  }

  async completeCheckout(
    id: string,
    params: CompleteUcpCheckoutParams,
  ): Promise<UcpCheckout> {
    const body: Record<string, unknown> = {
      spend_request_id: params.spend_request_id,
      profile_id: params.profile_id,
    };
    if (params.test) body.test = true;

    const { status, data, rawBody } = await this.apiFetch({
      method: 'POST',
      url: `${this.ucpEndpoint}/checkout/${encodeURIComponent(id)}/complete`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (status < 200 || status >= 300) {
      throw new LinkApiError(
        `Failed to complete UCP checkout (${status}): ${extractApiError(data, rawBody)}`,
        { status, rawBody, details: data },
      );
    }

    return normalizeCheckout(data);
  }

  async retrieveCheckout(
    id: string,
    params: RetrieveUcpCheckoutParams,
  ): Promise<UcpCheckoutWithSpendRequest> {
    const url = new URL(
      `${this.ucpEndpoint}/checkout/${encodeURIComponent(id)}`,
    );
    url.searchParams.set('spend_request_id', params.spend_request_id);
    if (params.test) url.searchParams.set('test', 'true');

    const { status, data, rawBody } = await this.apiFetch({
      method: 'GET',
      url: url.toString(),
    });

    if (status < 200 || status >= 300) {
      throw new LinkApiError(
        `Failed to retrieve UCP checkout (${status}): ${extractApiError(data, rawBody)}`,
        { status, rawBody, details: data },
      );
    }

    return normalizeCheckout(data) as UcpCheckoutWithSpendRequest;
  }
}
