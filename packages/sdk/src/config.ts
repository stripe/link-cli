import { LinkConfigurationError } from '@/errors';
import type { AccessTokenProvider } from '@/resources/interfaces';

export interface LinkSdkLogger {
  debug(message: string): void;
}

interface LinkClientOptions {
  verbose?: boolean;
  defaultHeaders?: Record<string, string>;
  fetch?: typeof globalThis.fetch;
  apiBaseUrl?: string;
  spendRequestBaseUrl?: string;
  logger?: LinkSdkLogger;
}

export type LinkOptions = LinkClientOptions &
  (
    | { accessToken: string; getAccessToken?: never }
    | { accessToken?: never; getAccessToken: AccessTokenProvider }
  );

export interface ResolvedLinkSdkConfig {
  verbose: boolean;
  getAccessToken: AccessTokenProvider;
  canRefreshAccessToken: boolean;
  fetch?: typeof globalThis.fetch;
  apiBaseUrl: string;
  spendRequestBaseUrl: string;
  logger: LinkSdkLogger;
}

const DEFAULT_API_BASE_URL = 'https://api.link.com';

function createDefaultHeadersFetch(
  baseFetch: typeof globalThis.fetch,
  defaultHeaders: Record<string, string>,
): typeof globalThis.fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    for (const [key, value] of Object.entries(defaultHeaders)) {
      if (!headers.has(key)) {
        headers.set(key, value);
      }
    }
    return baseFetch(input, { ...init, headers });
  }) as typeof globalThis.fetch;
}

export interface LinkSdkConfigDefaults {
  apiBaseUrl?: string;
  spendRequestBaseUrl?: string;
}

function createDefaultLogger(): LinkSdkLogger {
  return {
    debug() {},
  };
}

export function resolveLinkSdkConfig(
  options: LinkOptions,
  defaults: LinkSdkConfigDefaults = {},
): ResolvedLinkSdkConfig {
  const verbose = options.verbose ?? false;
  const logger = options.logger ?? createDefaultLogger();
  if (
    options.accessToken !== undefined &&
    options.getAccessToken !== undefined
  ) {
    throw new LinkConfigurationError(
      'Pass either `accessToken` or `getAccessToken`, not both.',
    );
  }

  let getAccessToken: AccessTokenProvider;
  let canRefreshAccessToken: boolean;
  if (options.accessToken !== undefined) {
    if (options.accessToken.trim().length === 0) {
      throw new LinkConfigurationError('`accessToken` cannot be empty.');
    }
    const accessToken = options.accessToken;
    getAccessToken = () => accessToken;
    canRefreshAccessToken = false;
  } else if (typeof options.getAccessToken === 'function') {
    getAccessToken = options.getAccessToken;
    canRefreshAccessToken = true;
  } else {
    throw new LinkConfigurationError(
      'Pass `accessToken` or `getAccessToken` to the Link client.',
    );
  }

  const apiBaseUrl =
    options.apiBaseUrl ?? defaults.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const spendRequestBaseUrl =
    options.spendRequestBaseUrl ?? defaults.spendRequestBaseUrl ?? apiBaseUrl;

  const baseFetch = options.fetch ?? globalThis.fetch;
  const effectiveFetch =
    options.defaultHeaders && Object.keys(options.defaultHeaders).length > 0
      ? createDefaultHeadersFetch(baseFetch, options.defaultHeaders)
      : baseFetch;

  return {
    verbose,
    getAccessToken,
    canRefreshAccessToken,
    fetch: effectiveFetch,
    apiBaseUrl,
    spendRequestBaseUrl,
    logger,
  };
}

export function requireFetchImplementation(
  config: Pick<ResolvedLinkSdkConfig, 'fetch'>,
): typeof globalThis.fetch {
  if (!config.fetch) {
    throw new LinkConfigurationError(
      'No fetch implementation available. Pass `fetch` in Link SDK options.',
    );
  }

  return config.fetch;
}
