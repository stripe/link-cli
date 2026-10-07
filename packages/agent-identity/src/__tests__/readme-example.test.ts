import assert from 'node:assert/strict';
import { test } from 'vitest';
import { LinkVerifier } from '@/index';
import { LinkFixture } from '@/testing/index';

test('accepts a Link token and rejects a forged token without WBA', async () => {
  const link = await LinkFixture.create();
  const verifier = new LinkVerifier({
    origin: 'shop.example',
    fetchImpl: link.fetchImpl(),
  });

  const token = await link.mint();
  assert.equal(
    (await verifier.verifyAttestation(token.authorization)).valid,
    true,
  );

  const forged = await link.mint({ corruptAuthenticator: true });
  const result = await verifier.verifyAttestation(forged.authorization);
  assert.equal(result.valid, false);
  if (!result.valid)
    assert.equal(result.failures[0]?.code, 'invalid_private_token');
});
