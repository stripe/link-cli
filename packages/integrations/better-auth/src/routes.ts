import { BASE_ERROR_CODES } from 'better-auth';
import {
  APIError,
  createAuthEndpoint,
  freshSessionMiddleware,
  linkSocialAccount,
  sensitiveSessionMiddleware,
} from 'better-auth/api';
import { decryptOAuthToken } from 'better-auth/oauth2';
import { z } from 'zod';
import { LINK_ERROR_CODES } from './error-codes';
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
      const { headers, response } = await linkSocialAccount({
        body: { ...ctx.body, provider: 'link' },
        context: ctx.context,
        headers: ctx.headers,
        ...(ctx.request ? { request: ctx.request } : {}),
        returnHeaders: true,
      });

      // Preserve OAuth state cookies and response headers from linkSocialAccount.
      for (const cookie of headers.getSetCookie()) {
        ctx.responseHeaders.append('set-cookie', cookie);
      }
      headers.forEach((value, key) => {
        if (key.toLowerCase() !== 'set-cookie') {
          ctx.responseHeaders.set(key, value);
        }
      });

      return ctx.json(response);
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
        throw APIError.from('BAD_REQUEST', BASE_ERROR_CODES.ACCOUNT_NOT_FOUND);
      }
      if (
        accounts.length === 1 &&
        !ctx.context.options.account?.accountLinking?.allowUnlinkingAll
      ) {
        throw APIError.from(
          'BAD_REQUEST',
          BASE_ERROR_CODES.FAILED_TO_UNLINK_LAST_ACCOUNT,
        );
      }
      if (!account.refreshToken) {
        throw APIError.from(
          'BAD_REQUEST',
          LINK_ERROR_CODES.LINK_REFRESH_TOKEN_NOT_FOUND,
        );
      }

      let response: Response;
      try {
        const token = await decryptOAuthToken(
          account.refreshToken,
          ctx.context,
        );
        response = await fetch('https://login.link.com/auth/revoke', {
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
      } catch {
        throw APIError.from(
          'BAD_GATEWAY',
          LINK_ERROR_CODES.LINK_REVOCATION_FAILED,
        );
      }
      if (!response.ok) {
        throw APIError.from(
          'BAD_GATEWAY',
          LINK_ERROR_CODES.LINK_REVOCATION_FAILED,
        );
      }

      await ctx.context.internalAdapter.deleteAccount(account.id);
      return ctx.json({ status: true });
    },
  );
