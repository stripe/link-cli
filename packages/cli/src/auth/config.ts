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

export function resolveAuthResourceConfig(
  options: AuthResourceOptions = {},
  defaults: Pick<ResolvedAuthResourceConfig, 'authBaseUrl'> = {
    authBaseUrl: DEFAULT_AUTH_BASE_URL,
  },
): ResolvedAuthResourceConfig {
  const verbose = options.verbose ?? false;

  return {
    verbose,
    clientName: options.clientName ?? 'Link CLI',
    defaultHeaders: options.defaultHeaders ?? {},
    fetch: options.fetch ?? globalThis.fetch,
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
