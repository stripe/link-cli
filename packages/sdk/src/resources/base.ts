import {
  type LinkOptions,
  requireFetchImplementation,
  resolveLinkSdkConfig,
} from '@/config';
import { LinkApiError, LinkTransportError } from '@/errors';
import type { AccessTokenProvider } from '@/resources/interfaces';

export interface ApiFetchOptions {
  method: string;
  url: string;
  headers?: Record<string, string>;
}

export interface ApiFetchResult {
  status: number;
  data: unknown;
  rawBody: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError(`Expected ${field} to be a boolean`);
  }
  return value;
}

export function extractErrorMessage(data: unknown, rawBody: string): string {
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

export abstract class BaseResource {
  protected readonly verbose: boolean;
  protected readonly getAccessToken: AccessTokenProvider;
  protected readonly fetchImpl: typeof globalThis.fetch;
  protected readonly endpoint: string;
  protected readonly logger: { debug(message: string): void };

  constructor(options: LinkOptions, endpointPath: string) {
    const config = resolveLinkSdkConfig(options);
    this.verbose = config.verbose;
    this.getAccessToken = config.getAccessToken;
    this.fetchImpl = requireFetchImplementation(config);
    this.endpoint = `${config.apiBaseUrl}${endpointPath}`;
    this.logger = config.logger;
  }

  protected async rawFetch(opts: ApiFetchOptions): Promise<ApiFetchResult> {
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

  protected async apiFetch(opts: ApiFetchOptions): Promise<ApiFetchResult> {
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

  protected throwApiError(
    operation: string,
    status: number,
    data: unknown,
    rawBody: string,
    cause?: unknown,
  ): never {
    const msg = extractErrorMessage(data, rawBody);
    throw new LinkApiError(`Failed to ${operation} (${status}): ${msg}`, {
      status,
      rawBody,
      details: data,
      cause,
    });
  }
}
