import net from 'node:net';
import { LinkConfigurationError } from '@/errors';
import type { AccessTokenProvider } from '@/resources/interfaces';
import { type AuthStorage, storage } from '@/utils/storage';

export interface LinkSdkLogger {
  debug(message: string): void;
}

export interface LinkOptions {
  verbose?: boolean;
  clientName?: string;
  defaultHeaders?: Record<string, string>;
  accessToken?: string;
  getAccessToken?: AccessTokenProvider;
  authStorage?: AuthStorage;
  fetch?: typeof globalThis.fetch;
  authBaseUrl?: string;
  apiBaseUrl?: string;
  spendRequestBaseUrl?: string;
  logger?: LinkSdkLogger;
}

export interface ResolvedLinkSdkConfig {
  verbose: boolean;
  clientName: string;
  getAccessToken: AccessTokenProvider;
  authStorage: AuthStorage;
  fetch?: typeof globalThis.fetch;
  authBaseUrl: string;
  apiBaseUrl: string;
  spendRequestBaseUrl: string;
  logger: LinkSdkLogger;
}

const DEFAULT_AUTH_BASE_URL = 'https://login.link.com';
const DEFAULT_API_BASE_URL = 'https://api.link.com';

function createProxyFetch(
  _baseFetch: typeof globalThis.fetch,
  proxyUrl: string,
): typeof globalThis.fetch {
  let clientPromise: Promise<{
    fetch: typeof globalThis.fetch;
    dispatcher: unknown;
  }> | null = null;

  const url = new URL(proxyUrl);
  const proxyHost = url.hostname;
  const proxyPort = Number(url.port);

  return ((input: RequestInfo | URL, init?: RequestInit) => {
    if (!clientPromise) {
      const mod = 'undici';
      clientPromise = (
        import(mod) as Promise<{
          Agent: new (opts?: unknown) => unknown;
          fetch: typeof globalThis.fetch;
        }>
      )
        .then((m) => {
          const dispatcher = new m.Agent({
            connect: (
              _opts: unknown,
              cb: (err: Error | null, socket: net.Socket | null) => void,
            ) => {
              const socket = net.connect(proxyPort, proxyHost, () =>
                cb(null, socket),
              );
              socket.on('error', (err) => cb(err, null));
            },
          });
          return { fetch: m.fetch, dispatcher };
        })
        .catch(() => {
          throw new LinkConfigurationError(
            'LINK_HTTP_PROXY requires the "undici" package. Install it with: npm install undici',
          );
        });
    }

    let targetUrl: string;
    if (typeof input === 'string') {
      targetUrl = input.replace(/^https:\/\//, 'http://');
    } else if (input instanceof URL) {
      targetUrl = input.href.replace(/^https:\/\//, 'http://');
    } else {
      targetUrl =
        (input as { url?: string }).url?.replace(/^https:\/\//, 'http://') ??
        String(input);
    }

    return clientPromise.then(({ fetch, dispatcher }) =>
      fetch(targetUrl, { ...init, dispatcher } as RequestInit),
    );
  }) as typeof globalThis.fetch;
}

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
  authBaseUrl?: string;
  apiBaseUrl?: string;
  spendRequestBaseUrl?: string;
}

function createDefaultLogger(verbose: boolean): LinkSdkLogger {
  return {
    debug(message: string) {
      if (!verbose) {
        return;
      }

      process.stderr.write(message.endsWith('\n') ? message : `${message}\n`);
    },
  };
}

export function resolveLinkSdkConfig(
  options: LinkOptions = {},
  defaults: LinkSdkConfigDefaults = {},
): ResolvedLinkSdkConfig {
  const verbose = options.verbose ?? false;
  const logger = options.logger ?? createDefaultLogger(verbose);
  const getAccessToken =
    typeof options.getAccessToken === 'function'
      ? options.getAccessToken
      : typeof options.accessToken === 'string'
        ? async () => options.accessToken as string
        : async () => {
            throw new LinkConfigurationError(
              'No access token configured. Pass `accessToken` or `getAccessToken` in Link SDK options.',
            );
          };
  const authBaseUrl =
    options.authBaseUrl ??
    defaults.authBaseUrl ??
    process.env.LINK_AUTH_BASE_URL ??
    DEFAULT_AUTH_BASE_URL;
  const apiBaseUrl =
    options.apiBaseUrl ??
    defaults.apiBaseUrl ??
    process.env.LINK_API_BASE_URL ??
    DEFAULT_API_BASE_URL;
  const spendRequestBaseUrl =
    options.spendRequestBaseUrl ?? defaults.spendRequestBaseUrl ?? apiBaseUrl;

  const proxyUrl = process.env.LINK_HTTP_PROXY;
  const baseFetch = options.fetch ?? globalThis.fetch;
  const proxyFetch =
    proxyUrl && !options.fetch
      ? createProxyFetch(baseFetch, proxyUrl)
      : baseFetch;
  const effectiveFetch =
    options.defaultHeaders && Object.keys(options.defaultHeaders).length > 0
      ? createDefaultHeadersFetch(proxyFetch, options.defaultHeaders)
      : proxyFetch;

  return {
    verbose,
    clientName: options.clientName ?? 'Link CLI',
    getAccessToken,
    authStorage: options.authStorage ?? storage,
    fetch: effectiveFetch,
    authBaseUrl,
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
