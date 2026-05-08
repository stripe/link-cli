import net from 'node:net';
import { LinkConfigurationError, type LinkSdkLogger } from '@stripe/link-sdk';

export interface AuthResourceOptions {
  verbose?: boolean;
  clientName?: string;
  defaultHeaders?: Record<string, string>;
  fetch?: typeof globalThis.fetch;
  authBaseUrl?: string;
  logger?: LinkSdkLogger;
}

export interface ResolvedAuthResourceConfig {
  verbose: boolean;
  clientName: string;
  defaultHeaders: Record<string, string>;
  fetch?: typeof globalThis.fetch;
  authBaseUrl: string;
  logger: LinkSdkLogger;
}

const DEFAULT_AUTH_BASE_URL = 'https://login.link.com';

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

    // Rewrite https:// to http:// so undici doesn't do TLS — certproxy handles it
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

export function resolveAuthResourceConfig(
  options: AuthResourceOptions = {},
  defaults: Pick<ResolvedAuthResourceConfig, 'authBaseUrl'> = {
    authBaseUrl: DEFAULT_AUTH_BASE_URL,
  },
): ResolvedAuthResourceConfig {
  const verbose = options.verbose ?? false;
  const proxyUrl = process.env.LINK_HTTP_PROXY;
  const baseFetch = options.fetch ?? globalThis.fetch;
  const effectiveFetch =
    proxyUrl && !options.fetch
      ? createProxyFetch(baseFetch, proxyUrl)
      : baseFetch;

  return {
    verbose,
    clientName: options.clientName ?? 'Link CLI',
    defaultHeaders: options.defaultHeaders ?? {},
    fetch: effectiveFetch,
    authBaseUrl:
      options.authBaseUrl ??
      process.env.LINK_AUTH_BASE_URL ??
      defaults.authBaseUrl,
    logger: options.logger ?? createDefaultLogger(verbose),
  };
}

export function requireFetchImplementation(
  config: Pick<ResolvedAuthResourceConfig, 'fetch'>,
): typeof globalThis.fetch {
  if (!config.fetch) {
    throw new LinkConfigurationError(
      'No fetch implementation available. Pass `fetch` in auth resource options.',
    );
  }

  return config.fetch;
}
