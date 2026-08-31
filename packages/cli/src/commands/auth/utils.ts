import type { JsonValue } from '@stripe/link-sdk';
import type { CliAuthStorage } from '../../auth/storage';

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
      scope?: string;
      authorizationDetails?: JsonValue[];
    }
  | { authenticated: false; source: 'storage'; credentialsPath: string };

export function resolveAuthInfo(
  envAccessToken: string | undefined,
  authStorage: CliAuthStorage,
): AuthInfo {
  if (envAccessToken) {
    return {
      authenticated: true,
      source: 'env',
      tokenPreview: `${envAccessToken.substring(0, 20)}...`,
      tokenType: 'Bearer',
    };
  }
  const auth = authStorage.getTokens();
  const credentialsPath = authStorage.getPath();
  if (auth) {
    return {
      authenticated: true,
      source: 'storage',
      tokenPreview: `${auth.access_token.substring(0, 20)}...`,
      tokenType: auth.token_type,
      credentialsPath,
      ...(auth.scope && { scope: auth.scope }),
      ...(auth.authorization_details && {
        authorizationDetails: auth.authorization_details,
      }),
    };
  }
  return { authenticated: false, source: 'storage', credentialsPath };
}
