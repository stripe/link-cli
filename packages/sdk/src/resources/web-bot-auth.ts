import {
  type LinkOptions,
  requireFetchImplementation,
  resolveLinkSdkConfig,
} from '@/config';
import { LinkApiError, LinkTransportError } from '@/errors';
import type {
  AccessTokenProvider,
  IWebBotAuthResource,
  SignatureHeaders,
} from '@/resources/interfaces';

export class WebBotAuthResource implements IWebBotAuthResource {
  private readonly verbose: boolean;
  private readonly getAccessToken: AccessTokenProvider;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly credentialsEndpoint: string;
  private readonly logger: { debug(message: string): void };
  private cache = new Map<string, SignatureHeaders>();

  constructor(options: LinkOptions) {
    const config = resolveLinkSdkConfig(options);
    this.verbose = config.verbose;
    this.getAccessToken = config.getAccessToken;
    this.fetchImpl = requireFetchImplementation(config);
    this.credentialsEndpoint = `${config.apiBaseUrl}/v1/agent_identity/credentials`;
    this.logger = config.logger;
  }

  // Per RFC 9421 §2.2.3: lowercase host, omit default ports.
  normalizeAuthority(url: string): string {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isDefaultPort =
      (parsed.protocol === 'https:' && (parsed.port === '443' || parsed.port === '')) ||
      (parsed.protocol === 'http:' && (parsed.port === '80' || parsed.port === ''));
    return isDefaultPort ? host : `${host}:${parsed.port}`;
  }

  private async apiFetch(
    authority: string,
    forceRefresh = false,
  ): Promise<SignatureHeaders> {
    const token = await this.getAccessToken({ forceRefresh });

    if (this.verbose) {
      this.logger.debug(`[web-bot-auth] POST ${this.credentialsEndpoint} authority=${authority}`);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(this.credentialsEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ authority }),
      });
    } catch (error) {
      throw new LinkTransportError(
        `Request failed: POST ${this.credentialsEndpoint}`,
        { cause: error },
      );
    }

    if (response.status === 401 && !forceRefresh) {
      return this.apiFetch(authority, true);
    }

    const rawBody = await response.text();
    let data: unknown = null;
    try {
      data = JSON.parse(rawBody);
    } catch {
      // non-JSON response
    }

    if (this.verbose) {
      this.logger.debug(`[web-bot-auth] < ${response.status}`);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new LinkApiError(
        `agent_identity/credentials failed (${response.status})`,
        { status: response.status, rawBody, details: data },
      );
    }

    const body = data as Record<string, unknown> | null;
    const wba = body?.web_bot_auth as SignatureHeaders | null | undefined;
    if (!wba) {
      throw new LinkApiError(
        'agent_identity/credentials response missing web_bot_auth',
        { status: response.status, rawBody, details: data },
      );
    }
    return wba;
  }

  async sign(url: string): Promise<SignatureHeaders> {
    const authority = this.normalizeAuthority(url);
    const result = await this.apiFetch(authority);
    this.cache.set(result.authority, result);
    if (this.verbose) {
      this.logger.debug(
        `[web-bot-auth] cached signature for ${result.authority} (expires ${result.expires_at})`,
      );
    }
    return result;
  }

  async getHeaders(url: string): Promise<Record<string, string>> {
    const authority = this.normalizeAuthority(url);
    const cached = this.cache.get(authority);

    if (!cached || Date.now() / 1000 > cached.expires_at - 30) {
      const fresh = await this.sign(url);
      return {
        Signature: fresh.signature,
        'Signature-Input': fresh.signature_input,
        'Signature-Agent': fresh.signature_agent,
      };
    }

    return {
      Signature: cached.signature,
      'Signature-Input': cached.signature_input,
      'Signature-Agent': cached.signature_agent,
    };
  }
}
