import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { createAttestationChallenge } from '@/challenge';
import {
  asBufferSource,
  fromBase64,
  toBase64url,
  toHex,
} from '@/internal/bytes';
import { importTokenKey, sha256 } from '@/internal/crypto';
import {
  parseRsaSpki,
  wrapRsaEncryptionSpki,
  wrapRsaSsaPssSpki,
} from '@/internal/der';
import { LinkIssuer } from '@/issuer';
import { LinkFixture } from '@/testing/index';

/**
 * Link's production token key, captured verbatim from
 * `https://api.link.com/.well-known/aap-issuer/token-keys`.
 *
 * Pinned as a static vector rather than generated, because the bug this file
 * exists for was invisible to generated keys: WebCrypto's `exportKey` emits an
 * encoding the verifier could read, and the encoding RFC 9578 section 6.5
 * actually mandates it could not. A fixture cannot produce the input that
 * triggers that, so a real key has to be checked in.
 *
 * This is public key material. Rotating it does not invalidate the test, since
 * nothing here depends on the key being current, only on it being real.
 */
const LINK_PRODUCTION_TOKEN_KEY =
  'MIIBUjA9BgkqhkiG9w0BAQowMKANMAsGCWCGSAFlAwQCAqEaMBgGCSqGSIb3DQEBCDALBglghkgBZQMEAgKiAwIBMAOCAQ8AMIIBCgKCAQEAuCOKto0LFFy6-2LYPYRwaLBYG4Rk7BnhmdYmmI2Cwkn2LYkIK9uaAhTTxIjHpoHJ7ZE9b5WlDF2HAk5-HRjsuA1ejhUBtgXWT7cu1BLJDAbBXMG60QqJFdah-7jEyyM8IB-bvxApn7N7Ff4HFQv0bmc6LiiGlvq5i8D7f4HlGAa-MDdj5i1M0ozz72Zz3Co9-Ng6yPoqgd_ex_jrAOMaRbxZo_NuF-NfDmC7Jm2kP2Z6LoDHHdClN2bngGsGQ8-KrScOgvjtioi5ZJTzVgoCSPpM7-GaL6dxqsWMgYCD7et_gcGP28joKyefMQr7OnC4e_YhCMQSbwkvQ11RfRY5ZQIDAQAB';

describe('Link production token key', () => {
  it('is the id-RSASSA-PSS encoding RFC 9578 mandates, not the WebCrypto export form', () => {
    const der = fromBase64(LINK_PRODUCTION_TOKEN_KEY);
    assert.equal(der.length, 342);

    const parsed = parseRsaSpki(der);
    assert.ok(typeof parsed !== 'string', `expected a parse, got: ${parsed}`);
    assert.equal(parsed.encoding, 'id-RSASSA-PSS');
    assert.equal(parsed.modulusBits, 2048);
    // 1.2.840.113549.1.1.10, not 1.2.840.113549.1.1.1.
    assert.equal(
      toHex(der.subarray(0, 17)),
      '30820152303d06092a864886f70d01010a',
    );
  });

  it('declares exactly the parameters RFC 9578 section 6.4 fixes', () => {
    const parsed = parseRsaSpki(fromBase64(LINK_PRODUCTION_TOKEN_KEY));
    assert.ok(typeof parsed !== 'string');
    assert.deepEqual(parsed.pssParams, {
      hash: 'SHA-384',
      mgf1Hash: 'SHA-384',
      saltLength: 48,
    });
  });

  it('imports, which is the whole point of this file', async () => {
    const key = await importTokenKey(fromBase64(LINK_PRODUCTION_TOKEN_KEY));
    assert.ok(typeof key !== 'string', `import failed: ${key}`);
    assert.equal(key.algorithm.name, 'RSA-PSS');
  });

  it('needs the re-wrap on this runtime, or says so explicitly', async () => {
    // Asserting a negative about a dependency is fragile: if Node ever adds
    // id-RSASSA-PSS SPKI import, which is a legitimate encoding and a plausible
    // improvement, a hard assertion here goes red for the wrong reason. So this
    // records which situation we are in rather than demanding one.
    let rawImportWorks = false;
    try {
      await globalThis.crypto.subtle.importKey(
        'spki',
        asBufferSource(fromBase64(LINK_PRODUCTION_TOKEN_KEY)),
        { name: 'RSA-PSS', hash: 'SHA-384' },
        false,
        ['verify'],
      );
      rawImportWorks = true;
    } catch {
      rawImportWorks = false;
    }

    if (rawImportWorks) {
      // The re-wrap is now belt-and-braces rather than load-bearing. Still correct,
      // and the byte-for-byte round-trip test below keeps it honest.
      console.log(
        'note: this runtime imports id-RSASSA-PSS SPKI directly; the re-wrap is no longer required here',
      );
    }
    // Either way the key must be usable through our own path.
    const key = await importTokenKey(fromBase64(LINK_PRODUCTION_TOKEN_KEY));
    assert.ok(typeof key !== 'string', `import failed: ${key}`);
  });

  it('re-wraps to the 294-byte rsaEncryption form without touching the key', () => {
    const parsed = parseRsaSpki(fromBase64(LINK_PRODUCTION_TOKEN_KEY));
    assert.ok(typeof parsed !== 'string');
    const rewrapped = wrapRsaEncryptionSpki(parsed.rsaPublicKey);
    assert.equal(rewrapped.length, 294);

    // Same RSAPublicKey inside both envelopes.
    const reparsed = parseRsaSpki(rewrapped);
    assert.ok(typeof reparsed !== 'string');
    assert.equal(reparsed.encoding, 'rsaEncryption');
    assert.deepEqual(reparsed.rsaPublicKey, parsed.rsaPublicKey);
  });

  it('round-trips through wrapRsaSsaPssSpki byte for byte', () => {
    // Proves the fixed AlgorithmIdentifier the fixtures publish is exactly the
    // one Link publishes, so a fixture key is not a near-miss of a real one.
    const der = fromBase64(LINK_PRODUCTION_TOKEN_KEY);
    const parsed = parseRsaSpki(der);
    assert.ok(typeof parsed !== 'string');
    assert.deepEqual(wrapRsaSsaPssSpki(parsed.rsaPublicKey), der);
  });
});

describe('token key acceptance', () => {
  it('accepts the rsaEncryption encoding too, since a verifier should tolerate it', async () => {
    const fixture = await LinkFixture.create('https://api.link.com', 0);
    await fixture.addKey({ encoding: 'rsaEncryption' });
    const issuer = new LinkIssuer({
      fetchImpl: fixture.fetchImpl(),
      minRefreshSeconds: 0,
    });
    const challenge = await createAttestationChallenge(issuer);
    assert.equal(challenge.wwwAuthenticate.length, 1);
  });

  it('refuses a key whose declared PSS parameters are not the ones we verify under', async () => {
    // Salt length 32 rather than 48. Verifying such a key with saltLength 48
    // would be verifying under a scheme the issuer did not publish.
    const der = fromBase64(LINK_PRODUCTION_TOKEN_KEY);
    const tampered = new Uint8Array(der);
    const saltOffset = indexOfSequence(
      tampered,
      [0xa2, 0x03, 0x02, 0x01, 0x30],
    );
    assert.notEqual(saltOffset, -1, 'expected to find the saltLength field');
    tampered[saltOffset + 4] = 0x20; // 48 -> 32

    const result = await importTokenKey(tampered);
    assert.equal(typeof result, 'string');
    assert.match(result as string, /32-byte PSS salt, expected 48/);
  });

  it('refuses a hash algorithm other than SHA-384', async () => {
    const der = fromBase64(LINK_PRODUCTION_TOKEN_KEY);
    const tampered = new Uint8Array(der);
    // sha384 OID ends in ...02 02; sha256 ends in ...02 01. The first occurrence
    // is the hashAlgorithm field.
    const offset = indexOfSequence(
      tampered,
      [0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x02],
    );
    assert.notEqual(offset, -1);
    tampered[offset + 8] = 0x01; // sha384 -> sha256

    const result = await importTokenKey(tampered);
    assert.equal(typeof result, 'string');
    assert.match(result as string, /SHA-256.*expected SHA-384/);
  });

  it('returns a reason rather than throwing on malformed DER', async () => {
    for (const input of [
      new Uint8Array(0),
      new Uint8Array([0x30]),
      new Uint8Array([0x30, 0x82, 0xff, 0xff]),
      new Uint8Array([0x02, 0x01, 0x00]),
      fromBase64(LINK_PRODUCTION_TOKEN_KEY).subarray(0, 100),
    ]) {
      const result = await importTokenKey(input);
      assert.equal(typeof result, 'string', 'malformed input must not import');
    }
  });

  it('refuses a modulus below 2048 bits', async () => {
    const pair = (await globalThis.crypto.subtle.generateKey(
      {
        name: 'RSA-PSS',
        modulusLength: 1024,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-384',
      },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    const spki = new Uint8Array(
      await globalThis.crypto.subtle.exportKey('spki', pair.publicKey),
    );
    const result = await importTokenKey(spki);
    assert.equal(typeof result, 'string');
    assert.match(result as string, /1024 bits, expected at least 2048/);
  });

  it('derives token_key_id from the published bytes, not the re-wrapped ones', async () => {
    const der = fromBase64(LINK_PRODUCTION_TOKEN_KEY);
    const parsed = parseRsaSpki(der);
    assert.ok(typeof parsed !== 'string');

    const publishedId = toBase64url(await sha256(der));
    const rewrappedId = toBase64url(
      await sha256(wrapRsaEncryptionSpki(parsed.rsaPublicKey)),
    );
    assert.notEqual(
      publishedId,
      rewrappedId,
      'the two encodings must hash differently, or this test proves nothing',
    );

    // The issuer must publish, and therefore key on, the first of those.
    const fixture = await LinkFixture.create('https://api.link.com', 1);
    const issuer = new LinkIssuer({
      fetchImpl: fixture.fetchImpl(),
      minRefreshSeconds: 0,
    });
    const [key] = await issuer.advertisableKeys();
    assert.ok(key !== undefined);
    assert.equal(
      key.tokenKeyId,
      toBase64url(await sha256(fromBase64(key.spkiBase64url))),
    );
  });
});

function indexOfSequence(
  haystack: Uint8Array,
  needle: readonly number[],
): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}
