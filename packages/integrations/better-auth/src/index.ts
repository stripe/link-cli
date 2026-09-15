import type { BetterAuthPlugin } from 'better-auth';
import {
  APIError,
  createAuthMiddleware,
  freshSessionMiddleware,
  getOAuthState,
} from 'better-auth/api';
import { decryptOAuthToken } from 'better-auth/oauth2';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import { z } from 'zod';

export interface LinkOptions {
  clientId: string;
  clientSecret: string;
  publishableKey: string;
  scopes?: string[];
}

export function link(options: LinkOptions) {
  for (const field of ['clientId', 'clientSecret', 'publishableKey'] as const) {
    if (!options[field]?.trim()) throw new Error(`Link ${field} is required.`);
  }
  const oauth = genericOAuth({
    config: [
      {
        providerId: 'link',
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        authorizationUrl: 'https://login.link.com/auth',
        tokenUrl: 'https://login.link.com/auth/token',
        userInfoUrl: 'https://api.link.com/userinfo',
        authorizationUrlParams: { key: options.publishableKey },
        scopes: options.scopes ?? ['payment_methods.agentic', 'userinfo:read'],
        pkce: true,
        disableSignUp: true,
        accessTokenExpiresIn: 3600,
        tokenEndpointAuth: {
          method: 'custom',
          customizeRequest({ body, headers }) {
            body.set('client_id', options.clientId);
            body.set('client_secret', options.clientSecret);
            headers.authorization = `Bearer ${options.publishableKey}`;
          },
        },
        async accountSubject({ profile }) {
          if (!(await getOAuthState())?.link) {
            throw new APIError('FORBIDDEN', {
              message: 'Use linkSocial to connect Link after signing in.',
            });
          }
          return z.email().parse(profile.email).toLowerCase();
        },
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
    hooks: {
      before: [
        {
          matcher: (ctx) =>
            ctx.path === '/sign-in/social' && ctx.body?.provider === 'link',
          handler: createAuthMiddleware(async () => {
            throw new APIError('FORBIDDEN', {
              message: 'Use linkSocial to connect Link after signing in.',
            });
          }),
        },
        {
          matcher: (ctx) => ctx.path === '/unlink-account',
          handler: createAuthMiddleware(
            { use: [freshSessionMiddleware] },
            async (ctx) => {
              const accounts = await ctx.context.internalAdapter.findAccounts(
                ctx.context.session.user.id,
              );
              // Let Better Auth enforce its normal last-account and ownership rules.
              if (
                accounts.length === 1 &&
                !ctx.context.options.account?.accountLinking?.allowUnlinkingAll
              )
                return;
              const account = accounts.find(
                (account) =>
                  account.id === ctx.body?.accountId &&
                  account.providerId === 'link',
              );
              if (!account?.refreshToken) return;
              const token = await decryptOAuthToken(
                account.refreshToken,
                ctx.context,
              );
              // Native unlink deletes the account; revoke the Link grant first.
              try {
                const response = await fetch(
                  'https://login.link.com/auth/revoke',
                  {
                    method: 'POST',
                    redirect: 'error',
                    signal: AbortSignal.timeout(15_000),
                    headers: {
                      authorization: `Bearer ${options.publishableKey}`,
                      'content-type': 'application/x-www-form-urlencoded',
                    },
                    body: new URLSearchParams({
                      client_id: options.clientId,
                      client_secret: options.clientSecret,
                      token,
                      token_type_hint: 'refresh_token',
                    }),
                  },
                );
                if (!response.ok) throw new Error('Link revocation failed.');
              } catch {
                throw new APIError('BAD_GATEWAY', {
                  message:
                    'Unable to revoke Link access. Retry unlinking the account.',
                });
              }
            },
          ),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
