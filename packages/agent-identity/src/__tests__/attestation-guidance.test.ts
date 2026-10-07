import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { assertFailed, firstFailure } from '@/__tests__/helpers';
import {
  type FailureCode,
  LinkIssuer,
  LinkVerifier,
  VerificationError,
  verifyAttestation,
  verifyAttestationOrThrow,
} from '@/index';
import { LinkFixture } from '@/testing/index';

const CLI_URL = 'https://github.com/stripe/link-cli';

describe('attestation recovery guidance', () => {
  it('preserves rejection codes and reasons and includes CLI guidance without echoing credentials', async () => {
    const link = await LinkFixture.create();
    const other = await LinkFixture.create();
    const issuer = new LinkIssuer({ fetchImpl: link.fetchImpl() });
    const forged = await link.mint({ corruptAuthenticator: true });
    const keyBound = await link.mint({
      agentKeyThumbprint: new Uint8Array(32).fill(7),
    });
    const unknown = await other.mint();
    const cases: [string | null | undefined, FailureCode, RegExp][] = [
      [
        null,
        'incomplete_protocol_request',
        /no Authorization credential supplied/,
      ],
      [
        undefined,
        'incomplete_protocol_request',
        /no Authorization credential supplied/,
      ],
      [
        '',
        'incomplete_protocol_request',
        /no Authorization credential supplied/,
      ],
      [
        'Bearer secret-attestation-input',
        'malformed_protocol_input',
        /not a PrivateToken credential/,
      ],
      [
        'PrivateToken token="not%base64"',
        'malformed_protocol_input',
        /token is not base64url/,
      ],
      [
        'PrivateToken token="AA=="',
        'malformed_protocol_input',
        /token is 1 bytes/,
      ],
      [
        forged.authorization,
        'invalid_private_token',
        /token authenticator does not verify/,
      ],
      [
        keyBound.authorization,
        'challenge_mismatch',
        /key-bound tokens are not supported/,
      ],
      [
        unknown.authorization,
        'unknown_issuer',
        /token_key_id does not resolve/,
      ],
    ];

    for (const [authorization, code, reason] of cases) {
      const failure = assertFailed(
        await verifyAttestation(authorization, { issuer }),
        code,
      );
      assert.match(failure.message, reason);
      assert.ok(failure.message.includes(CLI_URL));
      assert.match(
        failure.message,
        /obtain a Link bearer Agent Attestation Token/,
      );
      assert.match(failure.message, /retry with Authorization: PrivateToken/);
      if (authorization) assert.ok(!failure.message.includes(authorization));
    }
  });

  it('provides the same guidance through the facade and throwing APIs', async () => {
    const verifier = new LinkVerifier({ origin: 'https://service.example' });
    const failure = firstFailure(await verifier.verifyAttestation(null));
    assert.ok(failure.message.includes(CLI_URL));

    for (const verify of [
      () => verifier.verifyAttestationOrThrow(null),
      () => verifyAttestationOrThrow(null, { issuer: verifier.issuer }),
    ]) {
      await assert.rejects(verify, (error: unknown) => {
        assert.ok(error instanceof VerificationError);
        assert.equal(error.code, failure.code);
        assert.equal(error.message, failure.message);
        assert.deepEqual(error.failures, [failure]);
        return true;
      });
    }
  });

  it('does not tell agents to obtain another token during an issuer outage', async () => {
    const link = await LinkFixture.create();
    const token = await link.mint();
    const verifier = new LinkVerifier({
      origin: 'https://service.example',
      fetchImpl: async () => {
        throw new Error('issuer unavailable for this test');
      },
    });
    const failure = assertFailed(
      await verifier.verifyAttestation(token.authorization),
      'issuer_unavailable',
    );
    assert.match(failure.message, /issuer unavailable for this test/);
    assert.ok(!failure.message.includes(CLI_URL));
  });

  it('does not suggest an AAT as a replacement for an identity presentation', async () => {
    const verifier = new LinkVerifier({ origin: 'https://service.example' });
    for (const [presentation, code] of [
      [null, 'incomplete_protocol_request'],
      ['not-an-identity-presentation', 'invalid_claims_presentation'],
    ] as const) {
      const failure = assertFailed(
        await verifier.verifyClaims(presentation, {
          nonce: 'pending-interaction',
          requiredClaims: ['email'],
        }),
        code,
      );
      assert.ok(!failure.message.includes(CLI_URL));
    }
  });
});
