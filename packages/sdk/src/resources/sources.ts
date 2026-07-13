import {
  type LinkOptions,
  requireFetchImplementation,
  resolveLinkSdkConfig,
} from '@/config';
import { LinkApiError, LinkTransportError } from '@/errors';
import type {
  AccessTokenProvider,
  ISourcesResource,
  ListSourcesParams,
} from '@/resources/interfaces';
import type { Source, SourcesPage } from '@/types/index';

interface ApiFetchOptions {
  method: string;
  url: string;
  headers?: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError(`Expected ${field} to be a boolean`);
  }
  return value;
}

function extractErrorMessage(data: unknown, rawBody: string): string {
  if (isRecord(data)) {
    if (typeof data.error === 'string') {
      return data.error;
    }
    if (isRecord(data.error)) {
      const nested = data.error;
      if (typeof nested.message === 'string') {
        return nested.message;
      }
      if (typeof nested.code === 'string') {
        return nested.code;
      }
    }
    if (typeof data.message === 'string') {
      return data.message;
    }
  }

  return rawBody || 'unknown error';
}

function normalizeSources(value: unknown): Source[] {
  if (!Array.isArray(value)) {
    throw new TypeError('Expected sources to be an array');
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new TypeError(`Expected sources[${index}] to be an object`);
    }
    return item as Source;
  });
}

function normalizeSourcesPage(value: unknown): SourcesPage {
  if (!isRecord(value)) {
    throw new TypeError('Expected response body to be an object');
  }

  const { data, has_more, ...rest } = value;
  const normalized = normalizeSources(data);

  return {
    ...rest,
    data: normalized,
    ...(has_more !== undefined
      ? { has_more: requireBoolean(has_more, 'has_more') }
      : {}),
  };
}

export class SourcesResource implements ISourcesResource {
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
    this.endpoint = `${config.apiBaseUrl}/sources`;
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

  list(params: ListSourcesParams = {}): Promise<SourcesPage> {
    return this.listSources(params);
  }

  async listSources(params: ListSourcesParams = {}): Promise<SourcesPage> {
    const { status, data, rawBody } = await this.apiFetch({
      method: 'GET',
      url: this.buildUrl(params),
    });

    if (status < 200 || status >= 300) {
      const msg = extractErrorMessage(data, rawBody);
      throw new LinkApiError(`Failed to list sources (${status}): ${msg}`, {
        status,
        rawBody,
        details: data,
      });
    }

    try {
      return normalizeSourcesPage(data);
    } catch (error) {
      const reason = error instanceof Error ? `: ${error.message}` : '';
      throw new LinkApiError(
        `Failed to list sources (200): invalid response shape${reason}`,
        { status, rawBody, details: data, cause: error },
      );
    }
  }
}
