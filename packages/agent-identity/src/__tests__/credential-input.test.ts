import assert from 'node:assert/strict';
import { beforeAll, describe, it, vi } from 'vitest';
import { assertFailed } from '@/__tests__/helpers';
import { clearJwksCache } from '@/claims';
import { LinkVerifier, VerificationError } from '@/index';
import { fromBase64, toBase64Std, toBase64url } from '@/internal/bytes';
import { trimTrailingSlashes } from '@/internal/strings';
import { LinkIssuer } from '@/issuer';
import { CredentialFixture, combineFetch, LinkFixture } from '@/testing/index';

const AUD = 'https://events.example';
const OPTIONS = { nonce: 'registration-nonce', requiredClaims: ['email'] };
const segment = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

function replaceSegment(
  presentation: string,
  jwt: 'issuer' | 'holder',
  part: 0 | 1,
  value: unknown,
): string {
  const pieces = presentation.split('~');
  const index = jwt === 'issuer' ? 0 : pieces.length - 1;
  const segments = pieces[index]!.split('.');
  segments[part] = segment(value);
  pieces[index] = segments.join('.');
  return pieces.join('~');
}

function offlineVerifier() {
  const fetchImpl = vi.fn(async () => {
    throw new Error('unexpected issuer request');
  });
  return { verifier: new LinkVerifier({ origin: AUD, fetchImpl }), fetchImpl };
}

describe('bounded credential parsing', () => {
  it('rejects oversized fields before parsing or fetching', async () => {
    const { verifier, fetchImpl } = offlineVerifier();
    assert.match(
      assertFailed(
        await verifier.verifyAttestation(`PrivateToken ${' '.repeat(8192)}`),
        'malformed_protocol_input',
      ).message,
      /8192-character limit/,
    );
    assert.match(
      assertFailed(
        await verifier.verifyClaims('~'.repeat(65537), OPTIONS),
        'invalid_claims_presentation',
      ).message,
      /65536-character limit/,
    );
    assert.equal(fetchImpl.mock.calls.length, 0);
  });

  it('rejects padding runs and embedded newlines without an issuer request', async () => {
    const { verifier, fetchImpl } = offlineVerifier();
    for (const input of [
      `PrivateToken token="${'='.repeat(4000)}A"`,
      `PrivateToken token="${'='.repeat(400)}A"`,
      `PrivateToken ${' '.repeat(4000)}x\nx`,
      `PrivateToken token=${' '.repeat(4000)}x\rx`,
    ]) {
      assertFailed(
        await verifier.verifyAttestation(input),
        'malformed_protocol_input',
      );
    }
    assert.equal(fetchImpl.mock.calls.length, 0);
  });

  it('compares slash-heavy unsigned issuers without fetching', async () => {
    const { verifier, fetchImpl } = offlineVerifier();
    const issuerJwt = [
      segment({ typ: 'dc+sd-jwt', alg: 'EdDSA' }),
      segment({
        iss: `https://api.link.com/${'/'.repeat(32000)}x`,
        vct: 'example',
      }),
      'AA',
    ].join('.');
    assert.match(
      assertFailed(
        await verifier.verifyClaims(`${issuerJwt}~e30.e30.AA`, OPTIONS),
        'invalid_claims_presentation',
      ).message,
      /credential issuer/,
    );
    assert.equal(fetchImpl.mock.calls.length, 0);
  });

  it('preserves issuer slash normalization without removing internal slashes', () => {
    assert.equal(
      trimTrailingSlashes('https://api.link.com///'),
      'https://api.link.com',
    );
    const path = `https://api.link.com/${'/'.repeat(32000)}x`;
    assert.equal(trimTrailingSlashes(path), path);
    assert.equal(
      new LinkIssuer({ issuer: 'https://api.link.com///' }).issuer,
      'https://api.link.com',
    );
    assert.equal(trimTrailingSlashes(''), '');
  });

  it('accepts standard and URL-safe base64 with valid optional padding', () => {
    for (let size = 0; size < 40; size++) {
      const bytes = new Uint8Array(size).fill(255);
      assert.deepEqual(fromBase64(toBase64Std(bytes)), bytes);
      assert.deepEqual(fromBase64(toBase64url(bytes)), bytes);
      assert.deepEqual(
        fromBase64(
          toBase64Std(bytes).replaceAll('+', '-').replaceAll('/', '_'),
        ),
        bytes,
      );
    }
  });

  it('rejects misplaced or excess base64 padding and impossible lengths', () => {
    for (const input of [
      'A',
      'AA=',
      'A===',
      'AAAA=',
      '=AAA',
      'AA=A',
      `${'='.repeat(32000)}A`,
    ]) {
      assert.throws(() => fromBase64(input), /invalid base64/);
    }
  });
});

describe('JWT object shapes', () => {
  let verifier: LinkVerifier;
  let presentation: string;
  let authorization: string;

  beforeAll(async () => {
    clearJwksCache();
    const link = await LinkFixture.create();
    const credential = await CredentialFixture.create({
      issuerUrl: link.issuer,
      claims: { email: 'guest@example.com' },
    });
    verifier = new LinkVerifier({
      origin: AUD,
      fetchImpl: combineFetch(link.fetchImpl(), credential.fetchImpl()),
    });
    presentation = await credential.present({
      aud: AUD,
      nonce: OPTIONS.nonce,
      disclose: ['email'],
    });
    authorization = (await link.mint()).authorization;
    assert.equal(
      (await verifier.verifyClaims(presentation, OPTIONS)).valid,
      true,
    );
  });

  for (const jwt of ['issuer', 'holder'] as const) {
    for (const part of [0, 1] as const) {
      for (const value of [null, [], 'text', 42, true]) {
        it(`rejects ${jwt} ${part === 0 ? 'header' : 'payload'} containing ${JSON.stringify(value)}`, async () => {
          assert.match(
            assertFailed(
              await verifier.verifyClaims(
                replaceSegment(presentation, jwt, part, value),
                OPTIONS,
              ),
              'invalid_claims_presentation',
            ).message,
            /JSON objects/,
          );
        });
      }
    }
    for (const field of ['typ', 'alg']) {
      it(`rejects an object-valued ${jwt} ${field} without invoking its toString`, async () => {
        const header = {
          typ: jwt === 'issuer' ? 'dc+sd-jwt' : 'kb+jwt',
          alg: 'EdDSA',
          [field]: { toString: null },
        };
        assertFailed(
          await verifier.verifyClaims(
            replaceSegment(presentation, jwt, 0, header),
            OPTIONS,
          ),
          'invalid_claims_presentation',
        );
      });
    }
  }

  it('only the OrThrow API throws, with a VerificationError', async () => {
    await assert.rejects(
      verifier.verifyClaimsOrThrow(
        replaceSegment(presentation, 'issuer', 0, null),
        OPTIONS,
      ),
      (error: unknown) =>
        error instanceof VerificationError &&
        error.code === 'invalid_claims_presentation',
    );
  });

  it('still verifies valid credentials after malformed input and at the header size limit', async () => {
    const padded = `${authorization}, extra="${'x'.repeat(8192 - authorization.length - 10)}"`;
    assert.equal(padded.length, 8192);
    assert.equal((await verifier.verifyAttestation(padded)).valid, true);
    assertFailed(
      await verifier.verifyAttestation(`${padded} `),
      'malformed_protocol_input',
    );
    assert.equal(
      (await verifier.verifyClaims(presentation, OPTIONS)).valid,
      true,
    );
  });
});
