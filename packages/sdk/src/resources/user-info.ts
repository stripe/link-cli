import {
  type LinkOptions,
  requireFetchImplementation,
  resolveLinkSdkConfig,
} from '@/config';
import { LinkApiError, LinkTransportError } from '@/errors';
import type {
  AccessTokenProvider,
  IUserInfoResource,
} from '@/resources/interfaces';
import type { UserInfo } from '@/types/index';

interface ApiFetchOptions {
  method: string;
  url: string;
  headers?: Record<string, string>;
}

export class UserInfoResource implements IUserInfoResource {
  private readonly verbose: boolean;
  private readonly getAccessToken: AccessTokenProvider;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly userInfoEndpoint: string;
  private readonly logger: { debug(message: string): void };

  constructor(options: LinkOptions) {
    const config = resolveLinkSdkConfig(options);
    this.verbose = config.verbose;
    this.getAccessToken = config.getAccessToken;
    this.fetchImpl = requireFetchImplementation(config);
    this.userInfoEndpoint = `${config.apiBaseUrl}/userinfo`;
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
      // non-JSON response
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

  async retrieve(): Promise<UserInfo> {
    const { status, data, rawBody } = await this.apiFetch({
      method: 'GET',
      url: this.userInfoEndpoint,
    });

    if (status < 200 || status >= 300) {
      const body = data as Record<string, unknown> | null;
      const msg =
        (body?.error as string | undefined) ??
        (body?.message as string | undefined) ??
        (rawBody || 'unknown error');
      throw new LinkApiError(
        `Failed to retrieve user info (${status}): ${msg}`,
        {
          status,
          rawBody,
          details: data,
        },
      );
    }

    const body = data as Record<string, unknown> | null;
    return {
      email: (body?.email as string | null | undefined) ?? null,
      name: (body?.name as string | null | undefined) ?? null,
      first_name: (body?.first_name as string | null | undefined) ?? null,
      last_name: (body?.last_name as string | null | undefined) ?? null,
      phone: (body?.phone as string | null | undefined) ?? null,
    };
  }
}
