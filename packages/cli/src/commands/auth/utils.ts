import type { AuthStorage } from '@stripe/link-sdk';

export type AuthInfo =
  | {
      authenticated: true;
      source: 'env';
      tokenPreview: string;
      tokenType: string;
    }
  | {
      authenticated: true;
      source: 'storage';
      tokenPreview: string;
      tokenType: string;
      credentialsPath: string;
    }
  | { authenticated: false; source: 'storage'; credentialsPath: string };

export function resolveAuthInfo(
  envAccessToken: string | undefined,
  authStorage: AuthStorage,
): AuthInfo {
  if (envAccessToken) {
    return {
      authenticated: true,
      source: 'env',
      tokenPreview: `${envAccessToken.substring(0, 20)}...`,
      tokenType: 'Bearer',
    };
  }
  const auth = authStorage.getAuth();
  const credentialsPath = authStorage.getPath();
  if (auth) {
    return {
      authenticated: true,
      source: 'storage',
      tokenPreview: `${auth.access_token.substring(0, 20)}...`,
      tokenType: auth.token_type,
      credentialsPath,
    };
  }
  return { authenticated: false, source: 'storage', credentialsPath };
}
