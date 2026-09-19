import {
  APIError,
  createAuthEndpoint,
  dispatchAuthEndpoint,
  freshSessionMiddleware,
  linkSocialAccount,
  sensitiveSessionMiddleware,
} from 'better-auth/api';
import { decryptOAuthToken } from 'better-auth/oauth2';
import { z } from 'zod';
import type { LinkOptions } from './index';

export const connectLink = () =>
  createAuthEndpoint(
    '/link/connect',
    {
      method: 'POST',
      requireHeaders: true,
      body: linkSocialAccount.options.body.omit({
        provider: true,
        idToken: true,
      }),
    },
    async (ctx) => {
      const dispatched = await dispatchAuthEndpoint(linkSocialAccount, {
        asResponse: false,
        body: { ...ctx.body, provider: 'link' },
        context: ctx.context,
        headers: ctx.headers,
        ...(ctx.request ? { request: ctx.request } : {}),
        returnHeaders: true,
      });
      const result = dispatched as {
        headers: Headers | null;
        response: Awaited<ReturnType<typeof linkSocialAccount>>;
      };

      for (const cookie of result.headers?.getSetCookie() ?? []) {
        ctx.responseHeaders.append('set-cookie', cookie);
      }
      result.headers?.forEach((value, key) => {
        if (key.toLowerCase() !== 'set-cookie') {
          ctx.responseHeaders.set(key, value);
        }
      });

      return ctx.json(result.response);
    },
  );

export const disconnectLink = (options: LinkOptions) =>
  createAuthEndpoint(
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
