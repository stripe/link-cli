import assert from 'node:assert/strict';
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign,
} from 'node:crypto';
import { beforeAll, describe, it } from 'vitest';
import {
  concat,
  fromBase64,
  timingSafeEqual,
  toBase64Std,
  toBase64url,
  toBase64urlPadded,
  toHex,
} from '@/internal/bytes';
import {
  importTokenKey,
  sha256,
  sha384,
  sha512,
  verifyRsaPss,
} from '@/internal/crypto';
import { parseRsaSpki, wrapRsaSsaPssSpki } from '@/internal/der';

// Node produces the keys/signatures independently of the SDK's fixture adapters.
describe('native byte helpers', () => {
  it('preserves byte views and Uint8Array return values', async () => {
    const bytes = new Uint8Array([0, 0xfb, 0xff, 0xef, 0]);
    const view = bytes.subarray(1, 4);
    assert.equal(toBase64url(view), '-__v');
    assert.equal(toBase64Std(view), '+//v');
    assert.equal(toBase64urlPadded(view.subarray(0, 1)), '-w==');
    assert.equal(toHex(view), 'fbffef');
    assert.deepEqual(fromBase64('-__v'), view);
    assert.deepEqual(concat(view.subarray(0, 1), view.subarray(1)), view);
    assert.equal(
      timingSafeEqual(view, new Uint8Array([0xfb, 0xff, 0xef])),
      true,
    );
    assert.equal(
      timingSafeEqual(view, new Uint8Array([0xfb, 0xff, 0xee])),
      false,
    );
    assert.equal(timingSafeEqual(view, view.subarray(1)), false);
    assert.equal(timingSafeEqual(new Uint8Array(), new Uint8Array()), true);
    for (const [algorithm, hash] of [
      ['sha256', sha256],
      ['sha384', sha384],
      ['sha512', sha512],
    ] as const) {
      assert.deepEqual(
        await hash(view),
        new Uint8Array(createHash(algorithm).update(view).digest()),
      );
    }
  });

  it('refuses invalid characters that Buffer would silently ignore', () => {
    for (const encoded of [
      'Zm 8=',
      'Zm8=\n',
      'Zm8\r',
      'Zm$8',
      'Zm8\0',
      'Zm8é',
      'Zm8==',
      'AAAA====',
    ]) {
      assert.throws(() => fromBase64(encoded), /invalid base64/);
    }
  });
});

describe('native RSA key validation', () => {
  let spki: Uint8Array;
  let signature: Uint8Array;
  const message = new Uint8Array([1, 2, 3]);
  beforeAll(() => {
    const pair = generateKeyPairSync('rsa-pss', {
      modulusLength: 2048,
      hashAlgorithm: 'sha384',
      mgf1HashAlgorithm: 'sha384',
    });
    spki = new Uint8Array(
      pair.publicKey.export({ format: 'der', type: 'spki' }),
    );
    signature = new Uint8Array(
      sign('sha384', message, { key: pair.privateKey, saltLength: 48 }),
    );
  });

  it('keeps the public CryptoKey representation and verifies native signatures', async () => {
    const key = await importTokenKey(spki);
    assert.ok(typeof key !== 'string');
    assert.equal(key.type, 'public');
    assert.equal(key.extractable, false);
    assert.equal(key.algorithm.name, 'RSA-PSS');
    assert.deepEqual(key.usages, ['verify']);
    assert.equal(await verifyRsaPss(key, signature, message), true);
    assert.equal(
      await verifyRsaPss(key, signature, new Uint8Array([1, 2, 4])),
      false,
    );
    assert.equal(
      await verifyRsaPss(key, signature.subarray(1), message),
      false,
    );
  });

  it('checks the PSS trailer field that Node does not report', async () => {
    const parsed = parseRsaSpki(spki);
    assert.ok(typeof parsed !== 'string');
    const canonical = wrapRsaSsaPssSpki(parsed.rsaPublicKey);
    for (const trailer of [0, 1, 2]) {
      // Insert [3] trailerField into the fixture's fixed PSS AlgorithmIdentifier.
      const input = new Uint8Array(
        Buffer.concat([
          canonical.subarray(0, 67),
          Buffer.from([0xa3, 3, 2, 1, trailer]),
          canonical.subarray(67),
        ]),
      );
      input[3] = input[3]! + 5;
      input[5] = input[5]! + 5;
      input[18] = input[18]! + 5;
      assert.equal(
        createPublicKey({
          key: Buffer.from(input),
          format: 'der',
          type: 'spki',
        }).asymmetricKeyType,
        'rsa-pss',
      );
      const result = await importTokenKey(input);
      assert.equal(typeof result, trailer === 1 ? 'object' : 'string');
      if (trailer !== 1) assert.match(result as string, /trailerField/);
    }
  });

  it('rejects trailing data, oversized keys and non-RSA keys', async () => {
    const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    for (const [input, reason] of [
      [concat(spki, new Uint8Array([0])), /trailing bytes/],
      [new Uint8Array(8193), /implausibly large/],
      [
        new Uint8Array(ec.publicKey.export({ format: 'der', type: 'spki' })),
        /neither rsaEncryption nor id-RSASSA-PSS/,
      ],
    ] as const) {
      const result = await importTokenKey(input);
      assert.equal(typeof result, 'string');
      assert.match(result as string, reason);
    }
  });

  it('rejects weak public exponents even when Node imports them', async () => {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = pair.publicKey.export({ format: 'jwk' });
    for (const e of ['AQ', 'Ag']) {
      const key = createPublicKey({ key: { ...jwk, e }, format: 'jwk' });
      const result = await importTokenKey(
        new Uint8Array(key.export({ format: 'der', type: 'spki' })),
      );
      assert.equal(typeof result, 'string');
      assert.match(result as string, /exponent/);
    }
  });
});

// The DER reader replaces createPublicKey, which cannot parse id-RSASSA-PSS in
// Cloudflare Workers. Node remains the reference here.
describe('DER reader against Node', () => {
  function nodeDetails(spki: Uint8Array) {
    try {
      const key = createPublicKey({
        key: Buffer.from(spki),
        format: 'der',
        type: 'spki',
      });
      return key.asymmetricKeyType === 'rsa' ||
        key.asymmetricKeyType === 'rsa-pss'
        ? key.asymmetricKeyDetails
        : undefined;
    } catch {
      return undefined;
    }
  }

  const webCryptoName = (name: string | undefined) =>
    name?.toUpperCase().replace(/^SHA(\d+)$/, 'SHA-$1');

  it('reports the modulus and PSS parameters Node reports', () => {
    // SHA-1 is the DER default and so omitted from the encoding, which is refused
    // as before: the verifier requires explicit parameters.
    for (const hashAlgorithm of ['sha256', 'sha384', 'sha512']) {
      for (const mgf1HashAlgorithm of ['sha256', 'sha384']) {
        for (const saltLength of [0, 32, 48]) {
          // OpenSSL writes explicit NULL hash parameters, which Link's key omits.
          const spki = new Uint8Array(
            generateKeyPairSync('rsa-pss', {
              modulusLength: 2048,
              hashAlgorithm,
              mgf1HashAlgorithm,
              // @types/node declares this as a string; Node takes bytes.
              saltLength: saltLength as unknown as string,
            }).publicKey.export({ format: 'der', type: 'spki' }),
          );
          const details = nodeDetails(spki);
          const parsed = parseRsaSpki(spki);
          assert.ok(typeof parsed !== 'string', parsed as string);
          assert.equal(parsed.modulusBits, details?.modulusLength);
          assert.deepEqual(parsed.pssParams, {
            hash: webCryptoName(details?.hashAlgorithm),
            mgf1Hash: webCryptoName(details?.mgf1HashAlgorithm),
            saltLength: details?.saltLength,
          });
        }
      }
    }
  });

  it('never accepts a corrupted SPKI that Node refuses', () => {
    const rsa = new Uint8Array(
      generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({
        format: 'der',
        type: 'spki',
      }),
    );
    const parsed = parseRsaSpki(rsa);
    assert.ok(typeof parsed !== 'string');
    const nodePss = new Uint8Array(
      generateKeyPairSync('rsa-pss', {
        modulusLength: 2048,
        hashAlgorithm: 'sha384',
        mgf1HashAlgorithm: 'sha384',
      }).publicKey.export({ format: 'der', type: 'spki' }),
    );
    let refused = 0;
    for (const base of [rsa, wrapRsaSsaPssSpki(parsed.rsaPublicKey), nodePss]) {
      const inputs = [];
      for (let i = 0; i < 100; i++) {
        for (const mask of [0x01, 0x80, 0xff]) {
          const input = new Uint8Array(base);
          input[i] = (input[i] as number) ^ mask;
          inputs.push(input);
        }
        inputs.push(base.subarray(0, i));
      }
      for (const input of inputs) {
        if (nodeDetails(input) !== undefined) continue;
        refused++;
        assert.equal(typeof parseRsaSpki(input), 'string');
      }
    }
    assert.ok(refused > 500, `only ${refused} inputs refused by Node`);
  });
});
