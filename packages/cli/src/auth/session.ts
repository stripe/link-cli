import {
  type AccessTokenProvider,
  type AuthStorage,
  createAccessTokenProvider as createSdkAccessTokenProvider,
  type IAuthResource,
} from '@stripe/link-sdk';
import { storage } from './storage';

// Thin wrapper around the SDK's reusable `createAccessTokenProvider`: supplies
// the CLI's own `link-cli auth login` messaging (via the SDK's message
// options) so the CLI's user-facing error text is unchanged by the move, and
// defaults `authStorage` to the CLI's singleton `Storage` instance, which the
// SDK (used by other apps too) cannot default on its own.
export function createAccessTokenProvider(
  authResource: IAuthResource,
  authStorage: AuthStorage = storage,
  options: { noRefresh?: boolean } = {},
): AccessTokenProvider {
  return createSdkAccessTokenProvider(authResource, authStorage, {
    ...options,
    notAuthenticatedMessage:
      'Not authenticated. Run "link-cli auth login" first.',
    tokenExpiredMessage:
      'Access token expired. Re-authenticate with "link-cli auth login".',
  });
}
