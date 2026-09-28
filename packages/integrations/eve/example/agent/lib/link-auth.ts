import { randomUUID } from 'node:crypto';
import {
  ConnectionAuthorizationFailedError,
  ConnectionAuthorizationRequiredError,
  type ConnectionPrincipal,
  defineInteractiveAuthorization,
} from 'eve/connections';
import { config, getAuth } from './auth';

export function authorizationIdentifier(userId: string, attempt: string) {
  return `link-eve:${JSON.stringify([userId, attempt])}`;
}

function userId(principal: ConnectionPrincipal) {
  if (principal.type !== 'user' || principal.issuer !== config().origin) {
    throw new ConnectionAuthorizationFailedError('link', {
      reason: 'principal_required',
      retryable: false,
    });
  }
  return principal.id;
}

async function getToken({ principal }: { principal: ConnectionPrincipal }) {
  const id = userId(principal);
  const { auth, db } = await getAuth();
  const account = db
    .prepare("SELECT id FROM account WHERE userId = ? AND providerId = 'link'")
    .get(id);
  if (!account) throw new ConnectionAuthorizationRequiredError('link');
  const result = await auth.api.getAccessToken({
    body: { userId: id, accountId: String(account.id) },
  });
  if (!result.accessToken)
    throw new ConnectionAuthorizationRequiredError('link');
  return {
    token: result.accessToken,
    expiresAt: result.accessTokenExpiresAt?.getTime(),
  };
}

export const linkAuth = defineInteractiveAuthorization<{
  attempt: string;
  userId: string;
}>({
  displayName: 'Link',
  getToken,
  async startAuthorization({ principal, callbackUrl }) {
    const id = userId(principal);
    const target = new URL(callbackUrl);
    const { auth } = await getAuth();
    const attempt = randomUUID();
    const expiresAt = Date.now() + 10 * 60_000;
    target.searchParams.set('attempt', attempt);
    const { internalAdapter } = await auth.$context;
    await internalAdapter.createVerificationValue({
      identifier: authorizationIdentifier(id, attempt),
      value: target.href,
      expiresAt: new Date(expiresAt),
    });
    return {
      challenge: {
        displayName: 'Link',
        url: `${config().origin}/link/authorize/${attempt}`,
        expiresAt: new Date(expiresAt).toISOString(),
      },
      resume: { attempt, userId: id },
    };
  },
  async completeAuthorization({ principal, callback, resume }) {
    if (
      !resume ||
      resume.userId !== userId(principal) ||
      callback.params.attempt !== resume.attempt
    ) {
      throw new ConnectionAuthorizationFailedError('link', {
        reason: 'invalid_state',
        retryable: false,
      });
    }
    if (callback.params.error) {
      throw new ConnectionAuthorizationFailedError('link', {
        reason: 'authorization_failed',
        retryable: false,
      });
    }
    return getToken({ principal });
  },
});
