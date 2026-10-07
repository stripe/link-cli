import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { parseToken } from '@/attestation';
import { LinkIssuer } from '@/issuer';
import { LinkFixture } from '@/testing/index';

/**
 * A fetch wrapper that counts calls and can be made to fail or to serve
 * corrupted directories, so the recovery paths are observable.
 */
function instrument(fixture: LinkFixture) {
  const inner = fixture.fetchImpl();
  const state = {
    calls: 0,
    /** Set to a status to make token-keys fail. */
    failTokenKeysWith: 0,
    /** Set to replace the token-keys body. */
    tokenKeysBody: undefined as unknown,
    failMetadataWith: 0,
  };
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    state.calls++;
    if (
      state.failMetadataWith !== 0 &&
      url.endsWith('/.well-known/aap-issuer')
    ) {
      return new Response('boom', { status: state.failMetadataWith });
    }
    if (url.endsWith('/token-keys')) {
      if (state.failTokenKeysWith !== 0) {
        return new Response('boom', { status: state.failTokenKeysWith });
      }
      if (state.tokenKeysBody !== undefined) {
        return new Response(JSON.stringify(state.tokenKeysBody), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    return inner(input as RequestInfo, init);
  }) as typeof fetch;
  return { impl, state };
}

describe('directory refresh is atomic', () => {
  it('a single malformed entry does not unstamp the keys that parsed', async () => {
    // The original ordering bumped the generation before the entry loop and
    // recorded success after it, so a throw partway through left every warm key
    // stamped with a superseded generation, i.e. unusable, while lastRefresh still
    // claimed the cache was current.
    const fixture = await LinkFixture.create('https://api.link.com', 1);
    const { impl, state } = instrument(fixture);
    let clock = 1_000_000;
    const issuer = new LinkIssuer({
      fetchImpl: impl,
      minRefreshSeconds: 300,
      now: () => clock,
    });

    const minted = await fixture.mint();
    const parsed = parseToken(minted.raw);
    assert.ok(typeof parsed !== 'string');
    assert.ok(await issuer.resolveKey(parsed.tokenKeyId), 'warm to begin with');

    // Now the directory serves one undecodable entry ahead of the real key.
    const good = await (async () => {
      const res = await fixture.fetchImpl()(
        'https://api.link.com/.well-known/aap-issuer/token-keys',
      );
      return (await res.json()) as { 'token-keys': unknown[] };
    })();
    state.tokenKeysBody = {
      'token-keys': [
        { 'token-type': 2, 'token-key': 'not!valid!base64!' },
        ...good['token-keys'],
      ],
    };

    clock += 400;
    await issuer.refresh({ force: true });
    assert.ok(
      await issuer.resolveKey(parsed.tokenKeyId),
      'the good key must survive a bad sibling entry',
    );
  });

  it('recovers as soon as the upstream fault clears, rather than after the interval', async () => {
    // The measured symptom of the original bug: upstream healthy again
    // immediately, yet every request rejected for the whole refresh interval with
    // zero recovery attempts, because a present-but-stale key left `force` false.
    const fixture = await LinkFixture.create('https://api.link.com', 1);
    const { impl, state } = instrument(fixture);
    let clock = 1_000_000;
    const issuer = new LinkIssuer({
      fetchImpl: impl,
      minRefreshSeconds: 300,
      refreshFailureBackoffSeconds: 0,
      minForcedRefreshSeconds: 0,
      now: () => clock,
    });

    const minted = await fixture.mint();
    const parsed = parseToken(minted.raw);
    assert.ok(typeof parsed !== 'string');
    assert.ok(await issuer.resolveKey(parsed.tokenKeyId));

    // A transient upstream fault, observed by a refresh.
    state.failTokenKeysWith = 500;
    clock += 400;
    await assert.rejects(() => issuer.refresh({ force: true }));

    // Upstream is fine again one second later.
    state.failTokenKeysWith = 0;
    clock += 1;
    assert.ok(
      await issuer.resolveKey(parsed.tokenKeyId),
      'must recover immediately, not at the end of the refresh interval',
    );
  });

  it('treats a directory with no usable key as a failure, not an empty success', async () => {
    const fixture = await LinkFixture.create('https://api.link.com', 1);
    const { impl, state } = instrument(fixture);
    let clock = 1_000_000;
    const issuer = new LinkIssuer({
      fetchImpl: impl,
      minRefreshSeconds: 0,
      now: () => clock,
    });
    const minted = await fixture.mint();
    const parsed = parseToken(minted.raw);
    assert.ok(typeof parsed !== 'string');
    assert.ok(await issuer.resolveKey(parsed.tokenKeyId));

    state.tokenKeysBody = { 'token-keys': [] };
    clock += 10;
    await assert.rejects(
      () => issuer.refresh({ force: true }),
      /published no token keys/,
    );
    // Committing that empty directory would have retired the warm key.
    assert.ok(
      await issuer.resolveKey(parsed.tokenKeyId),
      'a warm key must survive an empty directory response',
    );
  });
});

describe('refresh rate limiting', () => {
  it('does not fetch upstream once per request for unrecognized key ids', async () => {
    const fixture = await LinkFixture.create('https://api.link.com', 1);
    const { impl, state } = instrument(fixture);
    let clock = 1_000_000;
    const issuer = new LinkIssuer({
      fetchImpl: impl,
      minRefreshSeconds: 3600,
      now: () => clock,
    });
    await issuer.advertisableKeys();
    const baseline = state.calls;

    // 50 sequential requests carrying key ids this verifier has never seen. An
    // attacker mints these for free, so they must not each cost an upstream fetch.
    for (let i = 0; i < 50; i++) {
      clock += 1;
      await issuer.resolveKey(`unknown-key-id-${i}`);
    }

    const fetches = state.calls - baseline;
    assert.ok(
      fetches <= 22,
      `50 unknown key ids should be throttled, saw ${fetches} upstream fetches`,
    );
  });

  it('backs off after a failure instead of refetching per request', async () => {
    const fixture = await LinkFixture.create('https://api.link.com', 1);
    const { impl, state } = instrument(fixture);
    let clock = 1_000_000;
    const issuer = new LinkIssuer({
      fetchImpl: impl,
      minRefreshSeconds: 0,
      refreshFailureBackoffSeconds: 30,
      minForcedRefreshSeconds: 0,
      now: () => clock,
    });

    state.failMetadataWith = 503;
    await assert.rejects(() => issuer.refresh({ force: true }));
    const afterFirstFailure = state.calls;

    for (let i = 0; i < 20; i++) {
      clock += 1;
      await assert.rejects(() => issuer.resolveKey('some-unknown-id'), /503/);
    }
    assert.equal(
      state.calls,
      afterFirstFailure,
      'inside the backoff window there must be no further upstream fetches',
    );

    // After backoff expires, retry the issuer rather than reusing its failure.
    clock += 30;
    await assert.rejects(() => issuer.resolveKey('some-unknown-id'), /503/);
    assert.ok(
      state.calls > afterFirstFailure,
      'must retry once the backoff expires',
    );
  });

  it('reports why the last refresh failed', async () => {
    const fixture = await LinkFixture.create('https://api.link.com', 1);
    const { impl, state } = instrument(fixture);
    const issuer = new LinkIssuer({ fetchImpl: impl, minRefreshSeconds: 0 });
    state.failMetadataWith = 503;
    await assert.rejects(() => issuer.refresh({ force: true }));
    assert.match(issuer.lastRefreshError() ?? '', /503/);
  });
});

describe('key freshness', () => {
  it('revalidates a cached key rather than trusting it for the process lifetime', async () => {
    // A verify-only deployment never calls the challenge path, so nothing ever
    // re-reads the directory: a cache hit short-circuited before any staleness
    // check and a revoked key stayed trusted indefinitely.
    const fixture = await LinkFixture.create('https://api.link.com', 2);
    let clock = 1_000_000;
    const issuer = new LinkIssuer({
      fetchImpl: fixture.fetchImpl(),
      minRefreshSeconds: 300,
      maxKeyAgeSeconds: 900,
      minForcedRefreshSeconds: 0,
      now: () => clock,
    });

    const minted = await fixture.mint({ keyIndex: 1 });
    const parsed = parseToken(minted.raw);
    assert.ok(typeof parsed !== 'string');
    assert.ok(await issuer.resolveKey(parsed.tokenKeyId));

    // Link revokes the key. Nothing else happens in this process: no challenges
    // are issued, only verification.
    fixture.retireKey(1);

    clock += 300;
    assert.ok(
      await issuer.resolveKey(parsed.tokenKeyId),
      'still inside the freshness window',
    );

    clock += 1000;
    assert.equal(
      await issuer.resolveKey(parsed.tokenKeyId),
      undefined,
      'past maxKeyAgeSeconds the key must be revalidated and found revoked',
    );
  });

  it('can be disabled, for a deployment that accepts restart-scoped revocation', async () => {
    const fixture = await LinkFixture.create('https://api.link.com', 2);
    let clock = 1_000_000;
    const issuer = new LinkIssuer({
      fetchImpl: fixture.fetchImpl(),
      minRefreshSeconds: 300,
      maxKeyAgeSeconds: 0,
      now: () => clock,
    });
    const minted = await fixture.mint({ keyIndex: 1 });
    const parsed = parseToken(minted.raw);
    assert.ok(typeof parsed !== 'string');
    assert.ok(await issuer.resolveKey(parsed.tokenKeyId));

    fixture.retireKey(1);
    clock += 86_400;
    assert.ok(
      await issuer.resolveKey(parsed.tokenKeyId),
      'with the ceiling disabled the cached key is kept',
    );
  });
});

describe('explicit refresh', () => {
  it('is never silently throttled, unlike the unknown-key path', async () => {
    const fixture = await LinkFixture.create('https://api.link.com', 2);
    const { impl, state } = instrument(fixture);
    const issuer = new LinkIssuer({
      fetchImpl: impl,
      minRefreshSeconds: 3600,
      minForcedRefreshSeconds: 3600,
    });
    await issuer.advertisableKeys();

    // An operator retiring a key needs the very next refresh to observe it, even
    // though the unknown-key path is rate limited to once an hour.
    const minted = await fixture.mint({ keyIndex: 1 });
    const parsed = parseToken(minted.raw);
    assert.ok(typeof parsed !== 'string');
    assert.ok(await issuer.resolveKey(parsed.tokenKeyId));

    fixture.retireKey(1);
    const before = state.calls;
    await issuer.refresh({ force: true });
    assert.ok(state.calls > before, 'an explicit forced refresh must fetch');
    assert.equal(await issuer.resolveKey(parsed.tokenKeyId), undefined);
  });
});
