/**
 * Published test vectors for the token-key path, run as tables.
 *
 * - RFC 9578 appendix A.2: full type 0x0002 tokens whose issuer key is the
 *   id-RSASSA-PSS SPKI section 6.5 mandates, the encoding Link publishes.
 * - Wycheproof RSASSA-PSS SHA-384 / MGF1-SHA-384 / 48-byte salt: valid and
 *   invalid signatures, each imported both as published (rsaEncryption) and
 *   re-wrapped as id-RSASSA-PSS, so the re-wrap path sees every vector.
 * - Wycheproof RSASSA-PSS keys with parameters: every hash, MGF1 hash and salt
 *   combination Wycheproof ships, checked against the parser and the profile.
 *
 * Fixtures live in ./vectors with their source and licence.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { encodeTokenChallenge, parseToken } from '@/attestation';
import { toBase64url } from '@/internal/bytes';
import { importTokenKey, sha256, verifyRsaPss } from '@/internal/crypto';
import { parseRsaSpki, wrapRsaSsaPssSpki } from '@/internal/der';

function fixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`./vectors/${name}`, import.meta.url), 'utf8'),
  ) as T;
}

const hex = (value: string) => new Uint8Array(Buffer.from(value, 'hex'));

async function importOrFail(spki: Uint8Array): Promise<CryptoKey> {
  const key = await importTokenKey(spki);
  assert.ok(typeof key !== 'string', key as string);
  return key;
}

/** Decodes a TokenChallenge (RFC 9577 section 2.1) back to its fields. */
function decodeTokenChallenge(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const tokenType = view.getUint16(offset);
  offset += 2;
  const issuerLength = view.getUint16(offset);
  offset += 2;
  const issuerName = new TextDecoder().decode(
    bytes.subarray(offset, offset + issuerLength),
  );
  offset += issuerLength;
  const redemptionLength = bytes[offset] as number;
  offset += 1;
  const redemptionContext = bytes.subarray(offset, offset + redemptionLength);
  offset += redemptionLength;
  const originLength = view.getUint16(offset);
  offset += 2;
  const originInfo = new TextDecoder().decode(
    bytes.subarray(offset, offset + originLength),
  );
  offset += originLength;
  assert.equal(offset, bytes.length, 'TokenChallenge has trailing bytes');
  return { tokenType, issuerName, redemptionContext, originInfo };
}

interface Rfc9578Vector {
  pkI: string;
  token_challenge: string;
  nonce: string;
  token: string;
}

describe('RFC 9578 appendix A.2, token type 0x0002', () => {
  const { vectors } = fixture<{ vectors: Rfc9578Vector[] }>(
    'rfc9578-type2.json',
  );
  assert.equal(vectors.length, 5);

  /** Token fields, as [name, offset] into the 354-byte token. */
  const TAMPER: ReadonlyArray<readonly [string, number]> = [
    ['nonce', 2],
    ['challenge_digest', 34],
    ['token_key_id', 66],
    ['authenticator, first byte', 98],
    ['authenticator, last byte', 353],
  ];

  describe.each(vectors.map((v, i) => [i + 1, v] as const))(
    'vector %i',
    (_n, vector) => {
      const pkI = hex(vector.pkI);
      const raw = hex(vector.token);
      const challenge = hex(vector.token_challenge);

      it('parses pkI as the mandated id-RSASSA-PSS SHA-384 key', () => {
        assert.deepEqual(
          (({ encoding, modulusBits, pssParams }) => ({
            encoding,
            modulusBits,
            pssParams,
          }))(
            parseRsaSpki(pkI) as Exclude<
              ReturnType<typeof parseRsaSpki>,
              string
            >,
          ),
          {
            encoding: 'id-RSASSA-PSS',
            modulusBits: 2048,
            pssParams: { hash: 'SHA-384', mgf1Hash: 'SHA-384', saltLength: 48 },
          },
        );
      });

      it('re-encodes the TokenChallenge byte for byte', () => {
        const fields = decodeTokenChallenge(challenge);
        assert.equal(fields.tokenType, 0x0002);
        const encoded = encodeTokenChallenge({
          issuerName: fields.issuerName,
          redemptionContext: fields.redemptionContext,
          originInfo: fields.originInfo,
        });
        assert.equal(
          Buffer.from(encoded).toString('hex'),
          vector.token_challenge,
        );
      });

      it('binds the token to its nonce, challenge and key', async () => {
        const token = parseToken(raw);
        assert.ok(typeof token !== 'string', token as string);
        assert.equal(Buffer.from(token.nonce).toString('hex'), vector.nonce);
        assert.deepEqual(token.challengeDigest, await sha256(challenge));
        // RFC 9578 section 6.5: SHA-256 over the published SPKI bytes.
        assert.equal(token.tokenKeyId, toBase64url(await sha256(pkI)));
      });

      it('verifies the authenticator under the published key', async () => {
        const token = parseToken(raw);
        assert.ok(typeof token !== 'string');
        const key = await importOrFail(pkI);
        assert.equal(
          await verifyRsaPss(key, token.authenticator, token.tokenInput),
          true,
        );
      });

      it.each(TAMPER)('refuses the token with %s flipped', async (_f, at) => {
        const tampered = new Uint8Array(raw);
        tampered[at] = (tampered[at] as number) ^ 0x01;
        const token = parseToken(tampered);
        assert.ok(typeof token !== 'string');
        const key = await importOrFail(pkI);
        assert.equal(
          await verifyRsaPss(key, token.authenticator, token.tokenInput),
          false,
        );
      });
    },
  );
});

interface WycheproofSignatureGroup {
  file: string;
  keySize: number;
  publicKeyDer: string;
  publicKeyAsn: string;
  tests: {
    tcId: number;
    comment: string;
    flags: string[];
    msg: string;
    sig: string;
    result: 'valid' | 'invalid' | 'acceptable';
  }[];
}

describe('Wycheproof RSASSA-PSS SHA-384, MGF1-SHA-384, 48-byte salt', () => {
  const { groups } = fixture<{ groups: WycheproofSignatureGroup[] }>(
    'wycheproof-rsa-pss-sha384.json',
  );

  const ENCODINGS = [
    [
      'rsaEncryption, as published',
      (g: WycheproofSignatureGroup) => hex(g.publicKeyDer),
    ],
    [
      'id-RSASSA-PSS, re-wrapped',
      (g: WycheproofSignatureGroup) => wrapRsaSsaPssSpki(hex(g.publicKeyAsn)),
    ],
  ] as const;

  describe.each(
    groups.flatMap((group) =>
      ENCODINGS.map(
        ([name, spki]) => [group.keySize, name, group, spki] as const,
      ),
    ),
  )('%i-bit key, %s', (_bits, _name, group, spki) => {
    const key = importOrFail(spki(group));

    it('has only valid and invalid vectors', () => {
      assert.ok(group.tests.every((t) => t.result !== 'acceptable'));
    });

    it.each(
      group.tests.map(
        (t) => [t.tcId, t.comment || t.flags.join(','), t] as const,
      ),
    )('tcId %i: %s', async (_id, _comment, t) => {
      assert.equal(
        await verifyRsaPss(await key, hex(t.sig), hex(t.msg)),
        t.result === 'valid',
      );
    });
  });
});

interface WycheproofParamKey {
  file: string;
  keySize: number;
  sha: string;
  mgfSha: string;
  sLen: number;
  publicKeyDer: string;
}

describe('Wycheproof RSASSA-PSS keys with explicit parameters', () => {
  const { keys } = fixture<{ keys: WycheproofParamKey[] }>(
    'wycheproof-rsa-pss-param-keys.json',
  );

  // DER omits a member equal to its RFC 4055 default, and this profile refuses
  // every default, so such keys must be refused by name before any other check.
  const usesDefault = (k: WycheproofParamKey) =>
    k.sha === 'SHA-1' || k.mgfSha === 'SHA-1' || k.sLen === 20;
  const isProfile = (k: WycheproofParamKey) =>
    k.sha === 'SHA-384' && k.mgfSha === 'SHA-384' && k.sLen === 48;

  it('covers the profile, a default and a foreign parameter set', () => {
    assert.ok(keys.some(isProfile));
    assert.ok(keys.some(usesDefault));
    assert.ok(keys.some((k) => !usesDefault(k) && !isProfile(k)));
  });

  it.each(keys.map((k) => [k.keySize, k.sha, k.mgfSha, k.sLen, k] as const))(
    '%i-bit %s / MGF1-%s / %i-byte salt',
    async (bits, sha, mgfSha, sLen, k) => {
      const der = hex(k.publicKeyDer);
      const parsed = parseRsaSpki(der);
      const imported = await importTokenKey(der);

      if (usesDefault(k)) {
        assert.equal(
          parsed,
          'RSASSA-PSS-params omits hash, MGF1, or salt length',
        );
        assert.equal(imported, parsed);
        return;
      }
      assert.ok(typeof parsed !== 'string', parsed as string);
      assert.equal(parsed.encoding, 'id-RSASSA-PSS');
      assert.equal(parsed.modulusBits, bits);
      assert.deepEqual(parsed.pssParams, {
        hash: sha,
        mgf1Hash: mgfSha,
        saltLength: sLen,
      });

      if (isProfile(k)) {
        assert.ok(typeof imported !== 'string', imported as string);
      } else if (sha !== 'SHA-384' || mgfSha !== 'SHA-384') {
        assert.equal(
          imported,
          'token key declares ' +
            sha +
            '/MGF1-' +
            mgfSha +
            ', expected SHA-384',
        );
      } else {
        assert.equal(
          imported,
          `token key declares a ${sLen}-byte PSS salt, expected 48`,
        );
      }
    },
  );
});
