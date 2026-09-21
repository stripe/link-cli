import type { UserInfo } from '@stripe/link-sdk';
import type { BetterAuthPlugin } from 'better-auth';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import { z } from 'zod';
import { LINK_ERROR_CODES } from './error-codes';
import { connectLink, disconnectLink } from './routes';

declare module '@better-auth/core' {
  interface BetterAuthPluginRegistry<AuthOptions, Options> {
    link: {
      creator: typeof link;
    };
  }
}

const linkProfileSchema = z.object({
  id: z.string().min(1),
}) satisfies z.ZodType<Pick<UserInfo, 'id'>>;

export interface LinkOptions {
  clientId: string;
  clientSecret: string;
  publishableKey: string;
  scopes?: string[];
  redirectURI?: string;
}

export function link(options: LinkOptions) {
  for (const field of ['clientId', 'clientSecret', 'publishableKey'] as const) {
    if (!options[field]?.trim()) throw new Error(`Link ${field} is required.`);
  }

  const oauth = genericOAuth({
    config: [
      {
        providerId: 'link',
        name: 'Link',
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        redirectURI: options.redirectURI,
        authorizationUrl: 'https://login.link.com/auth',
        tokenUrl: 'https://login.link.com/auth/token',
        userInfoUrl: 'https://api.link.com/userinfo',
        authorizationUrlParams: { key: options.publishableKey },
        scopes: options.scopes ?? ['payment_methods.agentic', 'userinfo:read'],
        pkce: true,
        accessTokenExpiresIn: 3600,
        tokenEndpointAuth: {
          method: 'custom',
          customizeRequest({ body, headers }) {
            body.set('client_id', options.clientId);
            body.set('client_secret', options.clientSecret);
            headers.authorization = `Bearer ${options.publishableKey}`;
          },
        },
        accountSubject: ({ profile }) => linkProfileSchema.parse(profile).id,
        mapProfileToUser(profile) {
          return {
            name:
              profile.name ||
              [profile.first_name, profile.last_name]
                .filter((part) => typeof part === 'string')
                .join(' ') ||
              'Link',
          };
        },
      },
    ],
  });

  return {
    ...oauth,
    id: 'link',
    endpoints: {
      connectLink: connectLink(),
      disconnectLink: disconnectLink(options),
    },
    $ERROR_CODES: LINK_ERROR_CODES,
  } satisfies BetterAuthPlugin;
}

export { LINK_ERROR_CODES } from './error-codes';
