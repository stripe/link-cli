import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'vitest';
import { assertFailed } from '@/__tests__/helpers';
import { clearJwksCache } from '@/claims';
import { LinkVerifier } from '@/index';
import { boundedGet } from '@/internal/http';
import { CredentialFixture, combineFetch, LinkFixture } from '@/testing/index';

const ORIGIN = 'https://shop.example';

function budget(fetchImpl: typeof fetch) {
  return { fetchImpl, timeoutMs: 1000, maxBytes: 64 * 1024 };
}

function redirect(status: number): Response {
  return new Response(null, {
    status,
    headers: { Location: 'https://attacker.example/' },
  });
}

/** What a browser returns for a redirected `redirect: 'manual'` fetch. */
const opaqueRedirect = {
  type: 'opaqueredirect',
  status: 0,
  ok: false,
  headers: new Headers(),
  body: null,
} as unknown as Response;

describe('boundedGet redirect policy', () => {
  it("requests redirect: 'manual', which Workers accept", async () => {
    let init: RequestInit | undefined;
    await boundedGet(
      'https://api.link.com/x',
      budget((async (_url, i) => {
        init = i;
        return new Response('{}');
      }) as typeof fetch),
    );
    assert.equal(init?.redirect, 'manual');
  });

  for (const [status, response] of [
    ...[301, 302, 303, 304, 307, 308].map((s) => [s, redirect(s)] as const),
    [0, opaqueRedirect] as const,
  ]) {
    it(`refuses a ${status} response`, async () => {
      const result = await boundedGet(
        'https://api.link.com/keys',
        budget((async () => response) as typeof fetch),
      );
      assert.deepEqual(result, {
        ok: false,
        reason: `fetch of /keys was redirected (${status}); redirects are not followed`,
      });
    });
  }

  it('calls fetchImpl unbound, as the Workers global fetch requires', async () => {
    let receiver: unknown = 'not called';
    const fetchImpl = function (this: unknown) {
      receiver = this;
      return Promise.resolve(new Response('{}'));
    } as unknown as typeof fetch;
    await boundedGet('https://api.link.com/x', budget(fetchImpl));
    assert.equal(receiver, undefined);
  });

  it('does not follow a real redirect with platform fetch', async () => {
    let followed = false;
    const server = createServer((req, res) => {
      if (req.url === '/target') followed = true;
      res.writeHead(302, { Location: '/target' }).end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    try {
      const { port } = server.address() as AddressInfo;
      const result = await boundedGet(`http://127.0.0.1:${port}/start`, {
        ...budget(globalThis.fetch),
        allowPrivateAddresses: true,
      });
      assert.equal(result.ok, false);
      assert.equal(followed, false);
    } finally {
      server.close();
    }
  });
});

describe('redirects through the verifier', () => {
  it('reports issuer_unavailable when issuer metadata or the credential JWKS redirects', async () => {
    clearJwksCache();
    const link = await LinkFixture.create();
    const credential = await CredentialFixture.create({
      issuerUrl: link.issuer,
      claims: { email: 'agent@example.com' },
    });
    const serve = combineFetch(link.fetchImpl(), credential.fetchImpl());

    const metadataRedirects = new LinkVerifier({
      origin: ORIGIN,
      fetchImpl: (async () => redirect(302)) as typeof fetch,
    });
    assertFailed(
      await metadataRedirects.verifyAttestation(
        (await link.mint()).authorization,
      ),
      'issuer_unavailable',
    );

    const jwksRedirects = new LinkVerifier({
      origin: ORIGIN,
      fetchImpl: (async (input, init) =>
        input.toString().endsWith('/jwks.json')
          ? redirect(307)
          : serve(input, init)) as typeof fetch,
    });
    const nonce = 'n-1';
    const presentation = await credential.present({
      aud: ORIGIN,
      nonce,
      disclose: ['email'],
    });
    assertFailed(
      await jwksRedirects.verifyClaims(presentation, {
        nonce,
        requiredClaims: ['email'],
      }),
      'issuer_unavailable',
    );
  });
});
