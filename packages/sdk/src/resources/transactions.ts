import {
  type LinkOptions,
  requireFetchImplementation,
  resolveLinkSdkConfig,
} from '@/config';
import { LinkApiError, LinkTransportError } from '@/errors';
import type {
  AccessTokenProvider,
  ITransactionsResource,
  ListTransactionsParams,
} from '@/resources/interfaces';
import type { Transaction, TransactionsPage } from '@/types/index';

interface ApiFetchOptions {
  method: string;
  url: string;
  headers?: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`Expected ${field} to be a string`);
  }
  return value;
}

function requireNullableString(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new TypeError(`Expected ${field} to be a string or null`);
  }
  return value;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Expected ${field} to be a finite number`);
  }
  return value;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError(`Expected ${field} to be a boolean`);
  }
  return value;
}

function normalizeTransactions(value: unknown): Transaction[] {
  if (!Array.isArray(value)) {
    throw new TypeError('Expected transactions to be an array');
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new TypeError(`Expected transactions[${index}] to be an object`);
    }

    return {
      id: requireString(item.id, `transactions[${index}].id`),
      source_id: requireNullableString(
        item.source_id,
        `transactions[${index}].source_id`,
      ),
      amount: requireNumber(item.amount, `transactions[${index}].amount`),
      currency: requireString(item.currency, `transactions[${index}].currency`),
      created_date: requireString(
        item.created_date,
        `transactions[${index}].created_date`,
      ),
      description: requireString(
        item.description,
        `transactions[${index}].description`,
      ),
      category: requireNullableString(
        item.category,
        `transactions[${index}].category`,
      ),
      status: requireString(item.status, `transactions[${index}].status`),
    };
  });
}

function normalizeTransactionsPage(value: unknown): TransactionsPage {
  if (Array.isArray(value)) {
    return { data: normalizeTransactions(value) };
  }

  if (!isRecord(value)) {
    throw new TypeError('Expected response body to be an object');
  }

  const { data, has_more, ...rest } = value;
  const normalized = normalizeTransactions(data);

  return {
    ...rest,
    data: normalized,
    ...(has_more !== undefined
      ? { has_more: requireBoolean(has_more, 'has_more') }
      : {}),
  };
}

export class TransactionsResource implements ITransactionsResource {
  private readonly verbose: boolean;
  private readonly getAccessToken: AccessTokenProvider;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly endpoint: string;
  private readonly logger: { debug(message: string): void };

  constructor(options: LinkOptions = {}) {
    const config = resolveLinkSdkConfig(options);
    this.verbose = config.verbose;
    this.getAccessToken = config.getAccessToken;
    this.fetchImpl = requireFetchImplementation(config);
    this.endpoint = `${config.apiBaseUrl}/transactions`;
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
    }

    let response: Response;
    try {
      response = await this.fetchImpl(opts.url, {
        method: opts.method,
        headers: opts.headers,
      });
    } catch (error) {
      throw new LinkTransportError(
        `Request failed: ${opts.method} ${opts.url}`,
        { cause: error },
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
      this.logger.debug(rawBody);
    }

    return { status: response.status, data, rawBody };
  }

  private async apiFetch(
    opts: ApiFetchOptions,
  ): Promise<{ status: number; data: unknown; rawBody: string }> {
    const token = await this.getAccessToken();
    const authedOpts = {
      ...opts,
      headers: {
        ...opts.headers,
        Authorization: `Bearer ${token}`,
      },
    };

    const res = await this.rawFetch(authedOpts);

    if (res.status === 401) {
      const refreshedToken = await this.getAccessToken({ forceRefresh: true });
      authedOpts.headers.Authorization = `Bearer ${refreshedToken}`;
      return this.rawFetch(authedOpts);
    }

    return res;
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
      url.searchParams.set('start_date', params.start_date);
    }
    if (params.end_date !== undefined) {
      url.searchParams.set('end_date', params.end_date);
    }
    if (params.category !== undefined) {
      url.searchParams.set('category', params.category);
    }

    return url.toString();
  }

  list(params: ListTransactionsParams = {}): Promise<TransactionsPage> {
    return this.listTransactions(params);
  }

  async listTransactions(
    params: ListTransactionsParams = {},
  ): Promise<TransactionsPage> {
    const { status, data, rawBody } = await this.apiFetch({
      method: 'GET',
      url: this.buildUrl(params),
    });

    if (status < 200 || status >= 300) {
      const body = data as Record<string, unknown> | null;
      const msg =
        (body?.error as string | undefined) ??
        (body?.message as string | undefined) ??
        (rawBody || 'unknown error');
      throw new LinkApiError(
        `Failed to list transactions (${status}): ${msg}`,
        { status, rawBody, details: data },
      );
    }

    try {
      return normalizeTransactionsPage(data);
    } catch (error) {
      const reason = error instanceof Error ? `: ${error.message}` : '';
      throw new LinkApiError(
        `Failed to list transactions (200): invalid response shape${reason}`,
        { status, rawBody, details: data, cause: error },
      );
    }
  }
}
