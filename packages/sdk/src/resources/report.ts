import {
  type LinkOptions,
  requireFetchImplementation,
  resolveLinkSdkConfig,
} from '@/config';
import { LinkApiError, LinkTransportError } from '@/errors';
import type {
  AccessTokenProvider,
  CreateReportParams,
  IReportResource,
  ReportRecord,
} from '@/resources/interfaces';

interface ApiFetchOptions {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

export class ReportResource implements IReportResource {
  private readonly verbose: boolean;
  private readonly getAccessToken: AccessTokenProvider;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly endpoint: string;
  private readonly logger: { debug(message: string): void };

  constructor(options: LinkOptions) {
    const config = resolveLinkSdkConfig(options);
    this.verbose = config.verbose;
    this.getAccessToken = config.getAccessToken;
    this.fetchImpl = requireFetchImplementation(config);
    this.endpoint = `${config.apiBaseUrl}/agent_observability`;
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

    let response: Response;
    try {
      response = await this.fetchImpl(opts.url, {
        method: opts.method,
        headers: opts.headers,
        body: opts.body,
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
      // non-JSON response
    }

    if (this.verbose) {
      this.logger.debug(`< ${response.status} ${response.statusText}`);
      this.logger.debug(JSON.stringify(data, null, 2) ?? rawBody);
    }

    return { status: response.status, data, rawBody };
  }

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

  async create(params: CreateReportParams): Promise<ReportRecord> {
    const { status, data, rawBody } = await this.apiFetch({
      method: 'POST',
      url: this.endpoint,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (status < 200 || status >= 300) {
      const message =
        data &&
        typeof data === 'object' &&
        'error' in data &&
        typeof (data as Record<string, unknown>).error === 'object'
          ? ((data as Record<string, { message?: string }>).error?.message ??
            rawBody)
          : rawBody;
      throw new LinkApiError(
        `Failed to create report (${status}): ${message}`,
        { status, rawBody, details: data },
      );
    }

    return data as ReportRecord;
  }
}
