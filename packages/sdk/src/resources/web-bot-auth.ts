import {
  type LinkOptions,
  requireFetchImplementation,
  resolveLinkSdkConfig,
} from '@/config';
import { LinkApiError, LinkTransportError } from '@/errors';
import type {
  AccessTokenProvider,
  IWebBotAuthResource,
} from '@/resources/interfaces';
import type { WebBotAuthBlock } from '@/types/index';

interface ApiFetchOptions {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

interface CacheEntry {
  block: WebBotAuthBlock;
  expiresAt: number;
}

const EXPIRY_BUFFER_MS = 30_000;

export class WebBotAuthResource implements IWebBotAuthResource {
  private readonly verbose: boolean;
  private readonly getAccessToken: AccessTokenProvider;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly credentialsEndpoint: string;
  private readonly logger: { debug(message: string): void };
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: LinkOptions) {
    const config = resolveLinkSdkConfig(options);
    this.verbose = config.verbose;
    this.getAccessToken = config.getAccessToken;
    this.fetchImpl = requireFetchImplementation(config);
    this.credentialsEndpoint = `${config.apiBaseUrl}/v1/agent_identity/credentials`;
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
      response.headers.forEach((value, key) => {
        this.logger.debug(`  ${key}: ${value}`);
      });
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

  async getHeaders(url: string): Promise<WebBotAuthBlock> {
    let authority: string;
    try {
      authority = new URL(url).hostname;
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }

    const cached = this.cache.get(authority);
    if (cached && Date.now() < cached.expiresAt - EXPIRY_BUFFER_MS) {
      return cached.block;
    }

    const { status, data, rawBody } = await this.apiFetch({
      method: 'POST',
      url: this.credentialsEndpoint,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    if (status < 200 || status >= 300) {
      const body = data as Record<string, unknown> | null;
      const msg =
        (body?.error as string | undefined) ??
        (body?.message as string | undefined) ??
        (rawBody || 'unknown error');
      throw new LinkApiError(
        `Failed to get web bot auth headers (${status}): ${msg}`,
        { status, rawBody, details: data },
      );
    }

    const body = data as Record<string, unknown> | null;
    const webBotAuth = body?.web_bot_auth as WebBotAuthBlock | undefined;
    if (!webBotAuth) {
      throw new LinkApiError('Credentials response missing web_bot_auth block', {
        status,
        rawBody,
        details: data,
      });
    }

    this.cache.set(authority, {
      block: webBotAuth,
      expiresAt: Date.parse(webBotAuth.expires_at),
    });

    return webBotAuth;
  }
}
