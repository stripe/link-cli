import {
  type LinkOptions,
  requireFetchImplementation,
  resolveLinkSdkConfig,
} from '@/config';
import { LinkApiError, LinkSdkError, LinkTransportError } from '@/errors';
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

// TODO: rawFetch/apiFetch is duplicated across all SDK resources. Extract into
// a shared ApiClient utility before adding more resources. Each copy has already
// diverged slightly (e.g. body support), making bugs harder to fix consistently.
export class WebBotAuthResource implements IWebBotAuthResource {
  private readonly verbose: boolean;
  private readonly getAccessToken: AccessTokenProvider;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly signEndpoint: string;
  private readonly logger: { debug(message: string): void };
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: LinkOptions) {
    const config = resolveLinkSdkConfig(options);
    this.verbose = config.verbose;
    this.getAccessToken = config.getAccessToken;
    // defaultHeaders (if any) are baked into config.fetch by resolveLinkSdkConfig
    // via createDefaultHeadersFetch — no separate field needed.
    this.fetchImpl = requireFetchImplementation(config);
    this.signEndpoint = `${config.apiBaseUrl}/web_bot_auth/sign`;
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

  /**
   * Returns Web Bot Auth signature headers for the given URL's authority.
   *
   * Pass the full merchant URL (e.g. `https://merchant.com/checkout`). The
   * authority (hostname) is extracted and used as the cache key — repeated
   * calls for the same domain within the 10-minute signature window are served
   * from cache without a network round-trip.
   *
   * Attach the returned `signature` and `signature_input` values as the
   * `Signature` and `Signature-Input` HTTP headers on outbound requests to
   * the merchant site.
   *
   * @throws {LinkSdkError} if `url` is not a valid URL
   * @throws {LinkSdkError} if the sign response is missing the web_bot_auth block
   * @throws {LinkApiError} if the sign endpoint returns a non-2xx status
   * @throws {LinkTransportError} if the network request fails
   */
  async getHeaders(url: string): Promise<WebBotAuthBlock> {
    let authority: string;
    try {
      authority = new URL(url).hostname;
    } catch {
      throw new LinkSdkError(`Invalid URL: ${url}`);
    }

    const cached = this.cache.get(authority);
    if (cached && Date.now() < cached.expiresAt - EXPIRY_BUFFER_MS) {
      return cached.block;
    }

    const { status, data, rawBody } = await this.apiFetch({
      method: 'POST',
      url: this.signEndpoint,
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
      throw new LinkSdkError(
        `Sign response missing web_bot_auth block (status ${status})`,
      );
    }

    const expiresAt = Date.parse(webBotAuth.expires_at);
    if (Number.isNaN(expiresAt)) {
      throw new LinkSdkError(
        `Credentials response has invalid expires_at: ${webBotAuth.expires_at}`,
      );
    }

    this.cache.set(authority, { block: webBotAuth, expiresAt });

    return webBotAuth;
  }
}
