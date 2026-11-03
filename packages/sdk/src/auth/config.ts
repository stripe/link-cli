import type { LinkSdkLogger } from '@/config';
import { requireFetchImplementation } from '@/config';
import { LinkConfigurationError } from '@/errors';

export interface AuthResourceOptions {
  /**
   * OAuth client_id to authenticate device-authorization requests as. Required
   * so an SDK-based app can't silently pose as another OAuth client (e.g.
   * link-cli).
   */
  clientId: string;
  verbose?: boolean;
  clientName?: string;
  defaultHeaders?: Record<string, string>;
  fetch?: typeof globalThis.fetch;
  authBaseUrl?: string;
  logger?: LinkSdkLogger;
}

export interface ResolvedAuthResourceConfig {
  clientId: string;
  verbose: boolean;
  clientName: string;
  defaultHeaders: Record<string, string>;
  fetch?: typeof globalThis.fetch;
  authBaseUrl: string;
  logger: LinkSdkLogger;
}

const DEFAULT_AUTH_BASE_URL = 'https://login.link.com';
const DEFAULT_CLIENT_NAME = 'Link SDK';

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
  options: AuthResourceOptions,
  defaults: Pick<ResolvedAuthResourceConfig, 'authBaseUrl'> = {
    authBaseUrl: DEFAULT_AUTH_BASE_URL,
  },
): ResolvedAuthResourceConfig {
  if (!options.clientId) {
    throw new LinkConfigurationError('`clientId` is required.');
  }

  const verbose = options.verbose ?? false;

  return {
    clientId: options.clientId,
    verbose,
    clientName: options.clientName ?? DEFAULT_CLIENT_NAME,
    defaultHeaders: options.defaultHeaders ?? {},
    fetch: options.fetch ?? globalThis.fetch,
    authBaseUrl:
      options.authBaseUrl ??
      process.env.LINK_AUTH_BASE_URL ??
      defaults.authBaseUrl,
    logger: options.logger ?? createDefaultLogger(verbose),
  };
}

// Auth resources need only `fetch` to resolve one, so the SDK's own
// `requireFetchImplementation` (from `@/config`) is reused as-is rather than
// duplicated here.
export { requireFetchImplementation };
