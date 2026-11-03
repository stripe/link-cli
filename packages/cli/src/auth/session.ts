import {
  type AccessTokenProvider,
  type AuthStorage,
  createAccessTokenProvider as createSdkAccessTokenProvider,
  type IAuthResource,
} from '@stripe/link-sdk';
import { storage } from './storage';

// Keeps the CLI's messages and default credential storage.
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
