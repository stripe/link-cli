import { defineChannel, GET } from 'eve/channels';
import { getLocalDevCapability } from 'eve/local-dev';
import { getAuth, getTerminalSession, sessionHeaders } from '../lib/auth';
import { authorizationIdentifier } from '../lib/link-auth';

const noCache = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
};

export default defineChannel({
  routes: [
    GET('/link/authorize/:attempt', async (_request, { params }) => {
      if (!getLocalDevCapability())
        return new Response('Local development only.', { status: 403 });
      const session = await getTerminalSession();
      const { auth } = await getAuth();
      const { internalAdapter } = await auth.$context;
      const pending = await internalAdapter.consumeVerificationValue(
        authorizationIdentifier(session.response.user.id, params.attempt ?? ''),
      );
      if (!pending) {
        return new Response('Authorization expired or invalid.', {
          status: 400,
          headers: noCache,
        });
      }
      const callbackUrl = pending.value;
      const errorCallback = new URL(callbackUrl);
      errorCallback.searchParams.set('error', 'authorization_failed');
      const result = await auth.api.connectLink({
        body: {
          callbackURL: callbackUrl,
          errorCallbackURL: errorCallback.href,
        },
        headers: sessionHeaders(session.headers),
        returnHeaders: true,
      });
      const headers = new Headers({
        ...noCache,
        location: result.response.url,
      });
      for (const cookie of [
        ...session.headers.getSetCookie(),
        ...result.headers.getSetCookie(),
      ]) {
        headers.append('set-cookie', cookie);
      }
      return new Response(null, { status: 302, headers });
    }),
    GET('/api/auth/callback/link', async (request) =>
      (await getAuth()).auth.handler(request),
    ),
  ],
});
