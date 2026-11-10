/**
 * Table-driven SPKI acceptance: every rule importTokenKey enforces, one row
 * each, built from named parts so a row reads as the encoding it tests.
 *
 * Rows go through importTokenKey, the single entry point the issuer uses, and
 * assert the exact reason, so a row cannot pass by failing for another reason.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { fromBase64 } from '@/internal/bytes';
import { importTokenKey } from '@/internal/crypto';
import { parseRsaSpki } from '@/internal/der';

// --- A minimal DER writer, enough to spell out each row. ---

type Bytes = Uint8Array | number[];
const u8 = (b: Bytes) => (b instanceof Uint8Array ? b : new Uint8Array(b));

function len(n: number): number[] {
  if (n < 0x80) return [n];
  if (n < 0x100) return [0x81, n];
  return [0x82, n >> 8, n & 0xff];
}
function tlv(tag: number, ...parts: Bytes[]): Uint8Array {
  const body = parts.flatMap((p) => [...u8(p)]);
  return new Uint8Array([tag, ...len(body.length), ...body]);
}
const seq = (...p: Bytes[]) => tlv(0x30, ...p);
const ctx = (n: number, ...p: Bytes[]) => tlv(0xa0 + n, ...p);
const int = (...b: number[]) => tlv(0x02, b);
const NULL = [0x05, 0x00];
const oid = (...b: number[]) => tlv(0x06, b);

const OID = {
  rsaEncryption: oid(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01),
  rsassaPss: oid(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0a),
  mgf1: oid(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x08),
  ecPublicKey: oid(0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01),
  sha256: oid(0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01),
  sha384: oid(0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x02),
  sha3_384: oid(0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x09),
};

// --- Link's production key, split into the parts rows recombine. ---

const LINK = fromBase64(
  'MIIBUjA9BgkqhkiG9w0BAQowMKANMAsGCWCGSAFlAwQCAqEaMBgGCSqGSIb3DQEBCDALBglghkgBZQMEAgKiAwIBMAOCAQ8AMIIBCgKCAQEAuCOKto0LFFy6-2LYPYRwaLBYG4Rk7BnhmdYmmI2Cwkn2LYkIK9uaAhTTxIjHpoHJ7ZE9b5WlDF2HAk5-HRjsuA1ejhUBtgXWT7cu1BLJDAbBXMG60QqJFdah-7jEyyM8IB-bvxApn7N7Ff4HFQv0bmc6LiiGlvq5i8D7f4HlGAa-MDdj5i1M0ozz72Zz3Co9-Ng6yPoqgd_ex_jrAOMaRbxZo_NuF-NfDmC7Jm2kP2Z6LoDHHdClN2bngGsGQ8-KrScOgvjtioi5ZJTzVgoCSPpM7-GaL6dxqsWMgYCD7et_gcGP28joKyefMQr7OnC4e_YhCMQSbwkvQ11RfRY5ZQIDAQAB',
);
const linkParsed = parseRsaSpki(LINK);
if (typeof linkParsed === 'string') throw new Error(linkParsed);
/** The 2048-bit modulus magnitude, without its 0x00 sign byte. */
const N = linkParsed.rsaPublicKey.subarray(9, 9 + 256);
const E = [0x01, 0x00, 0x01];

const rsaKey = (n: Bytes = [0x00, ...N], e: Bytes = E, ...extra: Bytes[]) =>
  seq(tlv(0x02, n), tlv(0x02, e), ...extra);
const bits = (key: Bytes = rsaKey(), unused = 0) => tlv(0x03, [unused], key);
const hashAlg = (h = OID.sha384, ...params: Bytes[]) => seq(h, ...params);
const mgf = (h: Uint8Array = hashAlg(), alg = OID.mgf1) => seq(alg, h);

function pssParams(
  o: { hash?: Uint8Array; mgf?: Uint8Array; salt?: number } = {},
): Uint8Array[] {
  return [
    ctx(0, o.hash ?? hashAlg()),
    ctx(1, o.mgf ?? mgf()),
    ctx(2, int(o.salt ?? 48)),
  ];
}
const pssAlg = (...fields: Bytes[]) => seq(OID.rsassaPss, seq(...fields));
const spki = (alg: Bytes = pssAlg(...pssParams()), key: Bytes = bits()) =>
  seq(alg, key);

type Expect = 'imports' | RegExp;

const ROWS: ReadonlyArray<readonly [string, Uint8Array, Expect]> = [
  // Accepted encodings.
  ['Link, NULLs omitted', spki(), 'imports'],
  [
    'OpenSSL, explicit NULL hash parameters',
    spki(
      pssAlg(
        ...pssParams({
          hash: hashAlg(OID.sha384, NULL),
          mgf: mgf(hashAlg(OID.sha384, NULL)),
        }),
      ),
    ),
    'imports',
  ],
  ['rsaEncryption', spki(seq(OID.rsaEncryption, NULL)), 'imports'],
  [
    'explicit trailerField 1',
    spki(pssAlg(...pssParams(), ctx(3, int(1)))),
    'imports',
  ],

  // PSS parameters this profile refuses.
  [
    'hash SHA-256',
    spki(pssAlg(...pssParams({ hash: hashAlg(OID.sha256) }))),
    /SHA-256\/MGF1-SHA-384, expected SHA-384/,
  ],
  [
    'MGF1 hash SHA-256',
    spki(pssAlg(...pssParams({ mgf: mgf(hashAlg(OID.sha256)) }))),
    /SHA-384\/MGF1-SHA-256/,
  ],
  [
    'salt 32',
    spki(pssAlg(...pssParams({ salt: 32 }))),
    /32-byte PSS salt, expected 48/,
  ],
  ['salt 0', spki(pssAlg(...pssParams({ salt: 0 }))), /0-byte PSS salt/],
  ['salt 49', spki(pssAlg(...pssParams({ salt: 49 }))), /49-byte PSS salt/],
  [
    'salt needs three bytes',
    spki(
      pssAlg(ctx(0, hashAlg()), ctx(1, mgf()), ctx(2, int(0x01, 0x00, 0x00))),
    ),
    /saltLength is implausibly large/,
  ],
  [
    'trailerField 2',
    spki(pssAlg(...pssParams(), ctx(3, int(2)))),
    /trailerField is not 1/,
  ],
  ['no parameters', spki(seq(OID.rsassaPss)), /carries no parameters/],
  [
    'NULL parameters',
    spki(seq(OID.rsassaPss, NULL)),
    /expected RSASSA-PSS-params SEQUENCE/,
  ],
  ['empty parameters', spki(pssAlg()), /omits hash, MGF1, or salt length/],
  [
    'salt omitted',
    spki(pssAlg(ctx(0, hashAlg()), ctx(1, mgf()))),
    /omits hash, MGF1, or salt length/,
  ],
  [
    'hash omitted',
    spki(pssAlg(ctx(1, mgf()), ctx(2, int(48)))),
    /omits hash, MGF1, or salt length/,
  ],
  [
    'fields out of order',
    spki(pssAlg(ctx(1, mgf()), ctx(0, hashAlg()), ctx(2, int(48)))),
    /unexpected PSS parameter/,
  ],
  [
    'field repeated',
    spki(
      pssAlg(
        ctx(0, hashAlg()),
        ctx(0, hashAlg()),
        ctx(1, mgf()),
        ctx(2, int(48)),
      ),
    ),
    /unexpected PSS parameter/,
  ],
  [
    'field [4]',
    spki(pssAlg(...pssParams(), ctx(4, int(1)))),
    /unexpected PSS parameter/,
  ],
  [
    'field with two values',
    spki(pssAlg(ctx(0, hashAlg(), NULL), ctx(1, mgf()), ctx(2, int(48)))),
    /unexpected PSS parameter/,
  ],
  [
    'mask generation not MGF1',
    spki(pssAlg(...pssParams({ mgf: mgf(hashAlg(), OID.sha384) }))),
    /maskGenAlgorithm is not MGF1/,
  ],
  [
    'MGF1 with extra member',
    spki(pssAlg(...pssParams({ mgf: seq(OID.mgf1, hashAlg(), NULL) }))),
    /maskGenAlgorithm has trailing members/,
  ],
  [
    'unknown hash SHA3-384',
    spki(pssAlg(...pssParams({ hash: hashAlg(OID.sha3_384) }))),
    /not a supported hash/,
  ],
  [
    'hash parameters not NULL',
    spki(pssAlg(...pssParams({ hash: hashAlg(OID.sha384, int(0)) }))),
    /parameters are not NULL/,
  ],
  [
    'hash with extra member',
    spki(pssAlg(...pssParams({ hash: hashAlg(OID.sha384, NULL, NULL) }))),
    /hashAlgorithm has trailing members/,
  ],

  // AlgorithmIdentifier.
  [
    'rsaEncryption without NULL',
    spki(seq(OID.rsaEncryption)),
    /rsaEncryption parameters are not NULL/,
  ],
  [
    'EC key',
    spki(seq(OID.ecPublicKey, NULL)),
    /neither rsaEncryption nor id-RSASSA-PSS/,
  ],
  [
    'AlgorithmIdentifier extra member',
    spki(seq(OID.rsaEncryption, NULL, NULL)),
    /AlgorithmIdentifier has trailing members/,
  ],
  [
    'AlgorithmIdentifier not a SEQUENCE',
    spki(OID.rsaEncryption),
    /expected AlgorithmIdentifier SEQUENCE/,
  ],

  // SubjectPublicKeyInfo envelope.
  [
    'extra SPKI member',
    seq(pssAlg(...pssParams()), bits(), NULL),
    /SubjectPublicKeyInfo has trailing bytes/,
  ],
  ['bytes after the SPKI', new Uint8Array([...spki(), 0x00]), /trailing bytes/],
  [
    'key in an OCTET STRING',
    spki(undefined, tlv(0x04, [0x00, ...rsaKey()])),
    /expected subjectPublicKey BIT STRING/,
  ],
  [
    'BIT STRING with unused bits',
    spki(undefined, bits(rsaKey(), 1)),
    /unused bits/,
  ],
  ['empty input', new Uint8Array(0), /malformed SPKI/],
  ['oversized input', new Uint8Array(8193), /implausibly large/],

  // RSAPublicKey.
  [
    'RSAPublicKey extra member',
    spki(undefined, bits(rsaKey(undefined, undefined, int(1)))),
    /RSAPublicKey has trailing members/,
  ],
  [
    'negative modulus',
    spki(undefined, bits(rsaKey([...N]))),
    /modulus is negative/,
  ],
  [
    'modulus padded with an extra 0x00',
    spki(undefined, bits(rsaKey([0x00, 0x00, ...N]))),
    /modulus is not minimally encoded/,
  ],
  [
    '1024-bit modulus',
    spki(undefined, bits(rsaKey([0x00, ...N.subarray(0, 128)]))),
    /1024 bits, expected at least 2048/,
  ],
  [
    'exponent 1',
    spki(undefined, bits(rsaKey(undefined, [0x01]))),
    /exponent 1 is not a valid odd exponent/,
  ],
  [
    'even exponent',
    spki(undefined, bits(rsaKey(undefined, [0x01, 0x00, 0x00]))),
    /exponent 65536 is not a valid odd exponent/,
  ],
  [
    'negative exponent',
    spki(undefined, bits(rsaKey(undefined, [0x81]))),
    /publicExponent is negative/,
  ],
  [
    'RSAPublicKey with trailing bytes',
    spki(undefined, tlv(0x03, [0x00], rsaKey(), [0x00])),
    /RSAPublicKey has trailing bytes/,
  ],

  // DER, not BER.
  [
    'primitive-form SEQUENCE (0x10)',
    new Uint8Array([0x10, ...spki().subarray(1)]),
    /expected SubjectPublicKeyInfo SEQUENCE/,
  ],
  [
    'saltLength as ENUMERATED',
    spki(pssAlg(ctx(0, hashAlg()), ctx(1, mgf()), ctx(2, tlv(0x0a, [48])))),
    /expected PSS saltLength INTEGER/,
  ],
  [
    'non-minimal length',
    new Uint8Array([0x30, 0x83, 0x00, ...spki().subarray(2)]),
    /not DER-encoded/,
  ],
  [
    'indefinite length',
    new Uint8Array([0x30, 0x80, ...spki().subarray(4), 0x00, 0x00]),
    /indefinite length/,
  ],
];

describe('SPKI acceptance table', () => {
  it("rebuilds Link's key byte for byte from the row parts", () => {
    assert.deepEqual(spki(), LINK);
  });

  it.each(ROWS)('%s', async (_name, der, expected) => {
    const result = await importTokenKey(der);
    if (expected === 'imports') {
      assert.ok(typeof result !== 'string', result as string);
    } else {
      assert.equal(typeof result, 'string', 'expected a refusal');
      assert.match(result as string, expected);
    }
  });
});

describe('single-bit corruption of the key structure', () => {
  // Every byte before the modulus magnitude is structure: tags, lengths, OIDs
  // and parameters. Flipping any bit there must be refused. The modulus sign
  // byte and the magnitude and exponent are excluded: flipping those yields a
  // different but well-formed key.
  const modulusSignByte = LINK.length - linkParsed.rsaPublicKey.length + 8;
  const cases = Array.from({ length: modulusSignByte * 8 }, (_, i) => [
    i >> 3,
    i & 7,
  ]);

  it.each(cases)('byte %i, bit %i', async (byte, bit) => {
    const der = new Uint8Array(LINK);
    der[byte] = (der[byte] as number) ^ (1 << bit);
    assert.equal(typeof (await importTokenKey(der)), 'string');
  });
});
