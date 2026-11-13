import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'vitest';
import { assertFailed, firstFailure } from '@/__tests__/helpers';
import { clearJwksCache, verifyClaimsPresentation } from '@/claims';
import type { Jwk } from '@/internal/crypto';
import { LinkIssuer } from '@/issuer';
import { CredentialFixture, combineFetch, LinkFixture } from '@/testing/index';
import type { ClaimsResult } from '@/types';
import { LinkVerifier } from '@/verifier';

const ISSUER = 'https://api.link.com';
const JWKS_URL = `${ISSUER}/.well-known/aap-issuer/jwks.json`;
const AUD = 'https://merchant.example';
const NONCE = 'rotation-nonce';
const TTL = 3600;
const THROTTLE = 30;

type Fault = 'network' | 'status-500' | 'bad-json' | 'not-object' | 'no-keys';

/**
 * A credential JWKS whose published keys and failure mode can be changed between
 * requests, counting every fetch of it. `hold()` parks fetches until released, so
 * concurrent callers can be made to overlap one in-flight request.
 */
class JwksServer {
  keys: Jwk[];
  fault: Fault | undefined;
  fetches = 0;
  private gate: Promise<void> | undefined;
  private open: (() => void) | undefined;

  constructor(keys: Jwk[]) {
    this.keys = keys;
  }

  hold(): void {
    this.gate = new Promise((resolve) => {
      this.open = resolve;
    });
  }

  release(): void {
    this.open?.();
    this.gate = undefined;
  }

  async waitForFetches(count: number): Promise<void> {
    for (let waited = 0; this.fetches < count; waited++) {
      assert.ok(
        waited < 1000,
        `expected ${count} JWKS fetches, saw ${this.fetches}`,
      );
      await sleep(1);
    }
  }

  readonly fetchImpl = (async (input: RequestInfo | URL) => {
    if (input.toString() !== JWKS_URL) {
      return new Response('not found', { status: 404 });
    }
    this.fetches++;
    if (this.gate !== undefined) await this.gate;
    switch (this.fault) {
      case 'network':
        throw new TypeError('fetch failed');
      case 'status-500':
        return new Response('boom', { status: 500 });
      case 'bad-json':
        return json('{"keys": [');
      case 'not-object':
        return json('"keys"');
      case 'no-keys':
        return json(JSON.stringify({ keys: [] }));
      default:
        return json(JSON.stringify({ keys: this.keys }));
    }
  }) as typeof fetch;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function json(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mintCredential(kid?: string): Promise<CredentialFixture> {
  return CredentialFixture.create({
    issuerUrl: ISSUER,
    claims: { email: 'ada@example.com' },
    ...(kid !== undefined ? { kid } : {}),
  });
}

async function setup(options: { jwksTtlSeconds?: number } = {}) {
  const link = await LinkFixture.create(ISSUER, 1);
  const original = await mintCredential();
  const server = new JwksServer([original.issuerJwk]);
  const fetchImpl = combineFetch(link.fetchImpl(), server.fetchImpl);
  const clock = { now: Math.floor(Date.now() / 1000) };
  const now = () => clock.now;
  const issuer = new LinkIssuer({ fetchImpl, now });

  const verify = async (credential: CredentialFixture): Promise<ClaimsResult> =>
    verifyClaimsPresentation({
      presentation: await credential.present({
        aud: AUD,
        nonce: NONCE,
        disclose: ['email'],
        iat: clock.now,
      }),
      audience: AUD,
      nonce: NONCE,
      issuer,
      requiredClaims: ['email'],
      fetchImpl,
      now,
      ...(options.jwksTtlSeconds !== undefined
        ? { jwksTtlSeconds: options.jwksTtlSeconds }
        : {}),
    });

  return { original, server, clock, verify };
}

function assertValid(result: ClaimsResult, why = ''): void {
  assert.equal(
    result.valid,
    true,
    `${why} ${result.valid ? '' : JSON.stringify(result.failures)}`.trim(),
  );
}

function assertSignatureRejected(result: ClaimsResult): void {
  const failure = assertFailed(result, 'invalid_claims_presentation');
  assert.equal(failure.message, 'issuer JWT signature does not verify');
}

beforeEach(() => {
  clearJwksCache();
});

describe('credential JWKS refetch on signing key rotation', () => {
  const rotations: {
    name: string;
    kid: string | undefined;
    keepOldKey: boolean;
  }[] = [
    {
      name: 'to a new kid, old key retired',
      kid: 'link-cred-2',
      keepOldKey: false,
    },
    {
      name: 'to a new kid, old key still published',
      kid: 'link-cred-2',
      keepOldKey: true,
    },
    {
      name: 'reusing the same kid for a new key',
      kid: undefined,
      keepOldKey: false,
    },
  ];

  for (const { name, kid, keepOldKey } of rotations) {
    it(`verifies after one refetch when Link rotates ${name}`, async () => {
      const { original, server, verify } = await setup();
      assertValid(await verify(original), 'warm');
      assert.equal(server.fetches, 1);

      const rotated = await mintCredential(kid);
      server.keys = keepOldKey
        ? [original.issuerJwk, rotated.issuerJwk]
        : [rotated.issuerJwk];

      assertValid(await verify(rotated), 'rotated credential');
      assert.equal(server.fetches, 2, 'exactly one refetch');

      assertValid(await verify(rotated), 'served from the refreshed cache');
      assert.equal(server.fetches, 2);

      const old = await verify(original);
      if (keepOldKey) {
        assertValid(old, 'old key is still published');
      } else {
        assertSignatureRejected(old);
      }
      assert.equal(
        server.fetches,
        2,
        'a retired key inside the throttle window costs no fetch',
      );
    });
  }

  it('makes no extra fetch for a valid presentation under a cached key', async () => {
    const { original, server, clock, verify } = await setup();
    for (let i = 0; i < 5; i++) {
      assertValid(await verify(original));
      clock.now += 60;
    }
    assert.equal(server.fetches, 1);
  });

  it('does not refetch a JWKS that was fetched during the same verification', async () => {
    const { server, verify } = await setup();
    const unpublished = await mintCredential('link-cred-2');
    assertSignatureRejected(await verify(unpublished));
    assert.equal(server.fetches, 1, 'the cold fetch is not repeated');
  });

  it('does not refetch after a TTL-expired fetch in the same verification', async () => {
    const { original, server, clock, verify } = await setup();
    assertValid(await verify(original));
    const unpublished = await mintCredential('link-cred-2');
    clock.now += TTL;
    assertSignatureRejected(await verify(unpublished));
    assert.equal(server.fetches, 2, 'one TTL fetch, no forced refetch on top');
  });

  it('refetches when the cached JWKS has no key usable for the credential', async () => {
    const { original, server, verify } = await setup();
    server.keys = [];
    const empty = await verify(original);
    assertFailed(empty, 'issuer_unavailable');
    assert.equal(
      firstFailure(empty).message,
      'could not resolve a Link credential signing key',
    );
    assert.equal(server.fetches, 1);

    server.keys = [original.issuerJwk];
    assertValid(
      await verify(original),
      'published after the empty JWKS was cached',
    );
    assert.equal(server.fetches, 2);
  });

  it('keeps reporting issuer_unavailable when the refetch for a keyless cache fails', async () => {
    const { original, server, verify } = await setup();
    server.keys = [];
    assertFailed(await verify(original), 'issuer_unavailable');

    server.keys = [original.issuerJwk];
    server.fault = 'status-500';
    const result = await verify(original);
    assertFailed(result, 'issuer_unavailable');
    assert.equal(
      firstFailure(result).message,
      'could not resolve a Link credential signing key',
    );
    assert.equal(server.fetches, 2);
  });
});

describe('credential JWKS refetch throttle', () => {
  for (const { wait, expectRefetch } of [
    { wait: 0, expectRefetch: false },
    { wait: THROTTLE - 1, expectRefetch: false },
    { wait: THROTTLE, expectRefetch: true },
    { wait: THROTTLE + 60, expectRefetch: true },
  ]) {
    it(`a second rotation ${wait}s after the first ${expectRefetch ? 'refetches' : 'is throttled'}`, async () => {
      const { original, server, clock, verify } = await setup();
      assertValid(await verify(original));

      const second = await mintCredential('link-cred-2');
      server.keys = [original.issuerJwk, second.issuerJwk];
      assertValid(await verify(second));
      assert.equal(server.fetches, 2);

      const third = await mintCredential('link-cred-3');
      server.keys = [second.issuerJwk, third.issuerJwk];
      clock.now += wait;
      const result = await verify(third);
      if (expectRefetch) {
        assertValid(result, 'outside the throttle window');
        assert.equal(server.fetches, 3);
      } else {
        assertSignatureRejected(result);
        assert.equal(server.fetches, 2);
        clock.now += THROTTLE;
        assertValid(await verify(third), 'once the window has passed');
        assert.equal(server.fetches, 3);
      }
    });
  }

  for (const { name, forge } of [
    {
      name: 'an unknown kid',
      forge: () => mintCredential('attacker-kid'),
    },
    {
      name: 'a known kid with a foreign signature',
      forge: () => mintCredential(),
    },
  ]) {
    it(`a flood of credentials under ${name} costs one refetch per window`, async () => {
      const { original, server, clock, verify } = await setup();
      assertValid(await verify(original));
      const forged = await forge();

      for (let i = 0; i < 10; i++) {
        assertSignatureRejected(await verify(forged));
        clock.now += 2;
      }
      assert.equal(server.fetches, 2, 'one forced refetch in 20s');

      clock.now += THROTTLE;
      assertSignatureRejected(await verify(forged));
      assert.equal(server.fetches, 3, 'the next window permits another');
      assertValid(await verify(original), 'the published key is unaffected');
      assert.equal(server.fetches, 3);
    });
  }

  it('is reset by clearJwksCache', async () => {
    const { original, server, verify } = await setup();
    assertValid(await verify(original));
    assertSignatureRejected(await verify(await mintCredential('attacker-kid')));
    assert.equal(server.fetches, 2);

    clearJwksCache();
    assertValid(await verify(original));
    assert.equal(server.fetches, 3, 'cold fetch after clearing');
    const rotated = await mintCredential('link-cred-2');
    server.keys = [rotated.issuerJwk];
    assertValid(await verify(rotated), 'throttle cleared with the cache');
    assert.equal(server.fetches, 4);
  });
});

describe('concurrent presentations after a rotation', () => {
  it('share one in-flight refetch', async () => {
    const { original, server, verify } = await setup();
    assertValid(await verify(original));
    const rotated = await mintCredential('link-cred-2');
    server.keys = [rotated.issuerJwk];

    server.hold();
    const pending = Array.from({ length: 8 }, () => verify(rotated));
    await server.waitForFetches(2);
    // Long enough for every caller to fail against the cache and reach the refetch.
    await sleep(50);
    server.release();

    for (const result of await Promise.all(pending)) assertValid(result);
    assert.equal(server.fetches, 2);
  });

  it('use a refetch another caller completed after they read the cache', async () => {
    const { original, server, verify } = await setup();
    assertValid(await verify(original));
    const rotated = await mintCredential('link-cred-2');
    server.keys = [rotated.issuerJwk];

    const results = await Promise.all(
      Array.from({ length: 8 }, () => verify(rotated)),
    );
    for (const result of results) assertValid(result);
    assert.equal(server.fetches, 2);
  });

  it('share one failed refetch, and all report the usual failure', async () => {
    const { original, server, verify } = await setup();
    assertValid(await verify(original));
    const rotated = await mintCredential('link-cred-2');
    server.keys = [rotated.issuerJwk];
    server.fault = 'network';

    server.hold();
    const pending = Array.from({ length: 8 }, () => verify(rotated));
    await server.waitForFetches(2);
    await sleep(50);
    server.release();

    for (const result of await Promise.all(pending)) {
      assertSignatureRejected(result);
    }
    assert.equal(server.fetches, 2);
  });
});

describe('a failed refetch', () => {
  const faults: Fault[] = [
    'network',
    'status-500',
    'bad-json',
    'not-object',
    'no-keys',
  ];

  for (const fault of faults) {
    it(`(${fault}) keeps the cached keys and reports the usual failure`, async () => {
      const { original, server, clock, verify } = await setup();
      assertValid(await verify(original));
      const rotated = await mintCredential('link-cred-2');
      server.keys = [rotated.issuerJwk];
      server.fault = fault;

      assertSignatureRejected(await verify(rotated));
      assert.equal(server.fetches, 2);

      assertValid(await verify(original), 'the cache was not poisoned');
      assertSignatureRejected(await verify(rotated));
      assert.equal(
        server.fetches,
        2,
        'the failed attempt consumed the throttle',
      );

      server.fault = undefined;
      clock.now += THROTTLE - 1;
      assertSignatureRejected(await verify(rotated));
      assert.equal(server.fetches, 2);

      clock.now += 1;
      assertValid(await verify(rotated), 'recovers in the next window');
      assert.equal(server.fetches, 3);
    });
  }

  it('does not extend the cached entry past its TTL', async () => {
    const { original, server, clock, verify } = await setup();
    assertValid(await verify(original));
    server.fault = 'status-500';
    clock.now += 10;
    assertSignatureRejected(await verify(await mintCredential('link-cred-2')));

    server.fault = undefined;
    clock.now += TTL - 10;
    assertValid(await verify(original));
    assert.equal(
      server.fetches,
      3,
      'the TTL still runs from the original fetch',
    );
  });
});

describe('credential JWKS TTL', () => {
  for (const ttl of [undefined, 60]) {
    it(`refetches on expiry with jwksTtlSeconds ${ttl ?? 'default'}`, async () => {
      const { original, server, clock, verify } = await setup(
        ttl !== undefined ? { jwksTtlSeconds: ttl } : {},
      );
      const effective = ttl ?? TTL;
      assertValid(await verify(original));
      clock.now += effective - 1;
      assertValid(await verify(original));
      assert.equal(server.fetches, 1);
      clock.now += 1;
      assertValid(await verify(original));
      assert.equal(server.fetches, 2);
    });
  }

  it('restarts from a successful refetch', async () => {
    const { original, server, clock, verify } = await setup();
    assertValid(await verify(original));
    clock.now += 3000;
    const rotated = await mintCredential('link-cred-2');
    server.keys = [original.issuerJwk, rotated.issuerJwk];
    assertValid(await verify(rotated));
    assert.equal(server.fetches, 2);

    clock.now += TTL - 1;
    assertValid(await verify(original));
    assert.equal(server.fetches, 2, 'still inside the TTL of the refetch');
    clock.now += 1;
    assertValid(await verify(original));
    assert.equal(server.fetches, 3);
  });
});

describe('LinkVerifier.verifyClaims across a rotation', () => {
  it('verifies a credential under a rotated key without waiting for the TTL', async () => {
    const link = await LinkFixture.create(ISSUER, 1);
    const original = await mintCredential();
    const server = new JwksServer([original.issuerJwk]);
    let now = Math.floor(Date.now() / 1000);
    const verifier = new LinkVerifier({
      origin: AUD,
      fetchImpl: combineFetch(link.fetchImpl(), server.fetchImpl),
      now: () => now,
    });
    const verify = async (credential: CredentialFixture) => {
      const challenge = await verifier.claimsChallenge({ claims: ['email'] });
      return verifier.verifyClaims(
        await credential.present({
          aud: challenge.body.aud,
          nonce: challenge.nonce,
          disclose: ['email'],
          iat: now,
        }),
        { nonce: challenge.nonce, requiredClaims: ['email'] },
      );
    };

    assertValid(await verify(original));
    const rotated = await mintCredential('link-cred-2');
    server.keys = [rotated.issuerJwk];
    now += 60;
    assertValid(await verify(rotated));
    assert.equal(server.fetches, 2);

    const third = await mintCredential('link-cred-3');
    server.keys = [third.issuerJwk];
    now += THROTTLE - 1;
    assertSignatureRejected(await verify(third));
    now += 1;
    assertValid(await verify(third));
    assert.equal(server.fetches, 3);
  });
});
