import {
  type AccessTokenProvider,
  type AuthStorage,
  LinkAuthenticationError,
  storage,
} from '@stripe/link-sdk';
import type { IAuthResource } from './types';

const EXPIRY_BUFFER_MS = 60_000;

export function createAccessTokenProvider(
  authResource: IAuthResource,
  authStorage: AuthStorage = storage,
  options: { noRefresh?: boolean } = {},
): AccessTokenProvider {
  return async ({ forceRefresh } = {}) => {
    const auth = authStorage.getAuth();
    if (!auth) {
      throw new LinkAuthenticationError(
        'Not authenticated. Run "link-cli auth login" first.',
      );
    }

    const isExpired =
      auth.expires_at != null &&
      Date.now() >= auth.expires_at - EXPIRY_BUFFER_MS;

    if (!forceRefresh && !isExpired) {
      return auth.access_token;
    }

    if (options.noRefresh) {
      throw new LinkAuthenticationError(
        'Access token expired. Re-authenticate with "link-cli auth login".',
      );
    }

    const refreshed = await authResource.refreshToken(auth.refresh_token);
    authStorage.setAuth(refreshed);
    return refreshed.access_token;
  };
}
