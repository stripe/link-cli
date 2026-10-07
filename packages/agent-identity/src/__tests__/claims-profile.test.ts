import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { firstFailure } from '@/__tests__/helpers';
import { createClaimsChallenge } from '@/challenge';
import { clearJwksCache, verifyClaimsPresentation } from '@/claims';
import { LinkIssuer } from '@/issuer';
import { CredentialFixture, combineFetch, LinkFixture } from '@/testing/index';

const AUD = 'https://merchant.example';

async function setup(
  credentialOptions: Partial<
    Parameters<typeof CredentialFixture.create>[0]
  > = {},
) {
  clearJwksCache();
  const link = await LinkFixture.create('https://api.link.com', 1);
  const cred = await CredentialFixture.create({
    issuerUrl: 'https://api.link.com',
    claims: { email: 'a@example.com', given_name: 'Ada' },
    ...credentialOptions,
  });
  const fetchImpl = combineFetch(link.fetchImpl(), cred.fetchImpl());
  const issuer = new LinkIssuer({ fetchImpl, minRefreshSeconds: 0 });
  const challenge = await createClaimsChallenge(issuer, {
    audience: AUD,
    claims: ['email', 'given_name'],
  });
  return { cred, issuer, challenge, fetchImpl };
}

describe('credential validity', () => {
  it('refuses a credential with no exp', async () => {
    // The verifier requires exp so credentials cannot be presented indefinitely
    // while their signing key remains trusted.
    const { cred, issuer, challenge, fetchImpl } = await setup({
      omitExp: true,
    });
    const result = await verifyClaimsPresentation({
      presentation: await cred.present({
        aud: AUD,
        nonce: challenge.nonce,
        disclose: ['email', 'given_name'],
      }),
      audience: AUD,
      nonce: challenge.nonce,
      issuer,
      fetchImpl,
      requiredClaims: ['email'],
    });
    assert.match(firstFailure(result).message, /no exp/);
  });

  it('does not grant clock skew past expiry', async () => {
    const { cred, issuer, challenge, fetchImpl } = await setup({
      expiresInSeconds: -1,
    });
    const result = await verifyClaimsPresentation({
      presentation: await cred.present({
        aud: AUD,
        nonce: challenge.nonce,
        disclose: ['email'],
      }),
      audience: AUD,
      nonce: challenge.nonce,
      issuer,
      fetchImpl,
      requiredClaims: ['email'],
    });
    assert.match(firstFailure(result).message, /expired/);
  });

  it('refuses an issuer JWT whose typ is not a credential type', async () => {
    // A JWT signed by a trusted issuer key must also have an accepted credential
    // type, even if it already has credential-shaped members.
    const { cred, issuer, challenge, fetchImpl } = await setup({
      typOverride: 'JWT',
    });
    const result = await verifyClaimsPresentation({
      presentation: await cred.present({
        aud: AUD,
        nonce: challenge.nonce,
        disclose: ['email'],
      }),
      audience: AUD,
      nonce: challenge.nonce,
      issuer,
      fetchImpl,
      requiredClaims: ['email'],
    });
    assert.match(firstFailure(result).message, /typ is "JWT"/);
  });
});

describe('required claims', () => {
  it('refuses to run without an explicit requiredClaims', async () => {
    // Omitting it accepted a presentation that disclosed nothing at all, and
    // returned valid: true with an empty claims object.
    const { cred, issuer, challenge, fetchImpl } = await setup();
    const result = await verifyClaimsPresentation({
      presentation: await cred.present({
        aud: AUD,
        nonce: challenge.nonce,
        disclose: [],
      }),
      audience: AUD,
      nonce: challenge.nonce,
      issuer,
      fetchImpl,
    } as never);
    assert.match(
      firstFailure(result).message,
      /requiredClaims must be supplied/,
    );
  });

  it('permits an explicitly empty requiredClaims', async () => {
    const { cred, issuer, challenge, fetchImpl } = await setup();
    const result = await verifyClaimsPresentation({
      presentation: await cred.present({
        aud: AUD,
        nonce: challenge.nonce,
        disclose: [],
      }),
      audience: AUD,
      nonce: challenge.nonce,
      issuer,
      fetchImpl,
      requiredClaims: [],
    });
    assert.equal(result.valid, true);
    if (result.valid) assert.deepEqual(result.claims, {});
  });

  it('allows the implementer to retry under-disclosure with the same expected nonce', async () => {
    const { cred, issuer, challenge, fetchImpl } = await setup();
    const shortfall = await verifyClaimsPresentation({
      presentation: await cred.present({
        aud: AUD,
        nonce: challenge.nonce,
        disclose: ['email'],
      }),
      audience: AUD,
      nonce: challenge.nonce,
      issuer,
      fetchImpl,
      requiredClaims: ['email', 'given_name'],
    });
    assert.match(firstFailure(shortfall).message, /does not disclose/);

    // Same nonce, now with everything asked for.
    const retry = await verifyClaimsPresentation({
      presentation: await cred.present({
        aud: AUD,
        nonce: challenge.nonce,
        disclose: ['email', 'given_name'],
      }),
      audience: AUD,
      nonce: challenge.nonce,
      issuer,
      fetchImpl,
      requiredClaims: ['email', 'given_name'],
    });
    assert.equal(retry.valid, true, 'the retry on the same nonce must succeed');
  });

  it('does not enforce presentation replay policy', async () => {
    const { cred, issuer, challenge, fetchImpl } = await setup();
    const args = {
      presentation: await cred.present({
        aud: AUD,
        nonce: challenge.nonce,
        disclose: ['email'],
      }),
      audience: AUD,
      nonce: challenge.nonce,
      issuer,
      fetchImpl,
      requiredClaims: ['email'],
    };
    assert.equal((await verifyClaimsPresentation(args)).valid, true);
    assert.equal((await verifyClaimsPresentation(args)).valid, true);
  });
});

describe('sd_hash covers the bytes as received', () => {
  it('rejects an injected empty tilde segment', async () => {
    // Recomputing sd_hash from the reassembled parts normalized this away, so the
    // binding was not byte-exact with what the holder signed.
    const { cred, issuer, challenge, fetchImpl } = await setup();
    const presentation = await cred.present({
      aud: AUD,
      nonce: challenge.nonce,
      disclose: ['email'],
    });
    const parts = presentation.split('~');
    const injected = [parts[0], '', ...parts.slice(1)].join('~');

    const result = await verifyClaimsPresentation({
      presentation: injected,
      audience: AUD,
      nonce: challenge.nonce,
      issuer,
      fetchImpl,
      requiredClaims: ['email'],
    });
    assert.match(firstFailure(result).message, /sd_hash/);
  });
});

describe('disclosure processing profile', () => {
  /** Runs a presentation from a validly signed but structurally odd credential. */
  async function verifyWith(
    credentialOptions: Partial<Parameters<typeof CredentialFixture.create>[0]>,
  ) {
    const { cred, issuer, challenge, fetchImpl } =
      await setup(credentialOptions);
    return verifyClaimsPresentation({
      presentation: await cred.present({
        aud: AUD,
        nonce: challenge.nonce,
        disclose: ['email'],
      }),
      audience: AUD,
      nonce: challenge.nonce,
      issuer,
      fetchImpl,
      requiredClaims: [],
    });
  }

  it('rejects a credential committing to the same digest twice', async () => {
    // RFC 9901 section 7.1 step 4. Building a Set silently deduped these.
    const result = await verifyWith({
      rewriteSd: (digests) => [...digests, digests[0]],
    });
    assert.match(firstFailure(result).message, /same digest more than once/);
  });

  it('refuses nested selective disclosure rather than silently dropping it', async () => {
    // Ignoring a nested _sd means claims the holder believes they disclosed never
    // reach the merchant, which is worse than refusing the credential outright.
    const result = await verifyWith({
      extraPayload: { address: { _sd: ['some-nested-digest'] } },
    });
    assert.match(firstFailure(result).message, /nested selective disclosure/);
  });

  it('rejects a disclosure using a reserved claim name', async () => {
    const result = await verifyWith({
      extraDisclosures: [['salt', '_sd', ['forged']]],
    });
    assert.match(firstFailure(result).message, /reserved claim name/);
  });

  it('rejects a disclosure colliding with a plaintext claim', async () => {
    const result = await verifyWith({
      extraPayload: { nickname: 'from-the-issuer' },
      extraDisclosures: [['salt', 'nickname', 'from-a-disclosure']],
    });
    assert.match(
      firstFailure(result).message,
      /collides with a plaintext claim/,
    );
  });

  it('names array-element disclosure as unsupported rather than malformed', async () => {
    const result = await verifyWith({
      extraDisclosures: [['salt', 'value-only']],
    });
    assert.match(
      firstFailure(result).message,
      /array-element disclosure is not supported/,
    );
  });
});
