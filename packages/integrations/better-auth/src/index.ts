import type { UserInfo } from '@stripe/link-sdk';
import type { BetterAuthPlugin } from 'better-auth';
import {
  APIError,
  createAuthEndpoint,
  freshSessionMiddleware,
  sensitiveSessionMiddleware,
} from 'better-auth/api';
import { decryptOAuthToken } from 'better-auth/oauth2';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import { z } from 'zod';

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
      disconnectLink: disconnectLink(options),
    },
  } satisfies BetterAuthPlugin;
}

function disconnectLink(options: LinkOptions) {
  return createAuthEndpoint(
    '/link/disconnect',
    {
      method: 'POST',
      requireHeaders: true,
      body: z.strictObject({ accountId: z.string().min(1) }),
      use: [sensitiveSessionMiddleware, freshSessionMiddleware],
    },
    async (ctx) => {
      const accounts = await ctx.context.internalAdapter.findAccounts(
        ctx.context.session.user.id,
      );
      const account = accounts.find(
        (candidate) =>
          candidate.id === ctx.body.accountId &&
          candidate.providerId === 'link',
      );
      if (!account) {
        throw new APIError('BAD_REQUEST', {
          code: 'ACCOUNT_NOT_FOUND',
          message: 'Link account not found.',
        });
      }
      if (
        accounts.length === 1 &&
        !ctx.context.options.account?.accountLinking?.allowUnlinkingAll
      ) {
        throw new APIError('BAD_REQUEST', {
          code: 'FAILED_TO_UNLINK_LAST_ACCOUNT',
          message: 'Add another sign-in method before disconnecting Link.',
        });
      }
      if (!account.refreshToken) {
        throw new APIError('BAD_REQUEST', {
          code: 'LINK_REFRESH_TOKEN_NOT_FOUND',
          message:
            'Link refresh token is missing. The account remains connected.',
        });
      }

      try {
        const token = await decryptOAuthToken(
          account.refreshToken,
          ctx.context,
        );
        const response = await fetch('https://login.link.com/auth/revoke', {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
          headers: {
            Authorization: `Bearer ${options.publishableKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: options.clientId,
            client_secret: options.clientSecret,
            token,
            token_type_hint: 'refresh_token',
          }),
        });
        if (!response.ok) throw new Error('Revocation rejected');
      } catch {
        throw new APIError('BAD_GATEWAY', {
          code: 'LINK_REVOCATION_FAILED',
          message:
            'Unable to revoke Link access. The account remains connected; try again.',
        });
      }

      await ctx.context.internalAdapter.deleteAccount(account.id);
      return ctx.json({ status: true });
    },
  );
}
