import { LinkAuthenticationError } from '@/auth/errors';
import type { AuthStorage, IAuthResource } from '@/auth/types';
import type { AccessTokenProvider } from '@/resources/interfaces';

const EXPIRY_BUFFER_MS = 60_000;

const DEFAULT_NOT_AUTHENTICATED_MESSAGE = 'Not authenticated.';
const DEFAULT_TOKEN_EXPIRED_MESSAGE =
  'Access token expired and refresh is disabled.';

export interface CreateAccessTokenProviderOptions {
  /** Never auto-refresh; throw instead once the access token has expired. */
  noRefresh?: boolean;
  /** Message for the error thrown when `storage` has no tokens at all. */
  notAuthenticatedMessage?: string;
  /** Message for the error thrown when `noRefresh` is set and the token has expired. */
  tokenExpiredMessage?: string;
}

/**
 * Builds an `AccessTokenProvider` backed by `storage`, auto-refreshing through
 * `authResource` shortly before expiry (or on a forced refresh / 401 retry).
 *
 * Link rotates the refresh token on every use, so two concurrent refreshes
 * would race: the second call's rotated refresh token would be discarded by
 * the first's `setTokens`, breaking the session. Concurrent callers that
 * observe an expired token while a refresh is already in flight share that
 * refresh's result instead of each starting their own.
 */
export function createAccessTokenProvider(
  authResource: IAuthResource,
  storage: AuthStorage,
  options: CreateAccessTokenProviderOptions = {},
): AccessTokenProvider {
  const notAuthenticatedMessage =
    options.notAuthenticatedMessage ?? DEFAULT_NOT_AUTHENTICATED_MESSAGE;
  const tokenExpiredMessage =
    options.tokenExpiredMessage ?? DEFAULT_TOKEN_EXPIRED_MESSAGE;

  let inFlightRefresh: Promise<string> | null = null;

  function refresh(refreshToken: string): Promise<string> {
    if (!inFlightRefresh) {
      inFlightRefresh = (async () => {
        try {
          const refreshed = await authResource.refreshToken(refreshToken);
          await storage.setTokens(refreshed);
          return refreshed.access_token;
        } finally {
          inFlightRefresh = null;
        }
      })();
    }
    return inFlightRefresh;
  }

  return async ({ forceRefresh } = {}) => {
    const auth = await storage.getTokens();
    if (!auth) {
      throw new LinkAuthenticationError(notAuthenticatedMessage);
    }

    const isExpired =
      auth.expires_at != null &&
      Date.now() >= auth.expires_at - EXPIRY_BUFFER_MS;

    if (!forceRefresh && !isExpired) {
      return auth.access_token;
    }

    if (options.noRefresh) {
      throw new LinkAuthenticationError(tokenExpiredMessage);
    }

    return refresh(auth.refresh_token);
  };
}
