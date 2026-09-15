import { generateKeyPairSync, type KeyObject, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  generateBlindedMessages,
  unblindSignatures,
} from '@/resources/attestations-crypto';

function bytesToBigInt(bytes: Uint8Array): bigint {
  return BigInt(`0x${Buffer.from(bytes).toString('hex')}`);
}

function bigIntToBytes(value: bigint, length: number): Uint8Array {
  return new Uint8Array(
    Buffer.from(value.toString(16).padStart(length * 2, '0'), 'hex'),
  );
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let current = base % modulus;
  let remaining = exponent;
  while (remaining > 0n) {
    if (remaining & 1n) {
      result = (result * current) % modulus;
    }
    remaining >>= 1n;
    current = (current * current) % modulus;
  }
  return result;
}

function decodeJwkInteger(value: string): bigint {
  return bytesToBigInt(new Uint8Array(Buffer.from(value, 'base64url')));
}

function asPrivacyPassIssuerKey(publicKey: KeyObject): Uint8Array {
  const rsaSpki = publicKey.export({ format: 'der', type: 'spki' });
  const bitStringMarker = Buffer.from('0382010f00', 'hex');
  const bitStringOffset = rsaSpki.indexOf(bitStringMarker);
  if (bitStringOffset < 0) throw new Error('Expected 2048-bit RSA SPKI');

  const pssAlgorithm = Buffer.from(
    '303d06092a864886f70d01010a3030a00d300b0609608648016503040202' +
      'a11a301806092a864886f70d010108300b0609608648016503040202' +
      'a203020130',
    'hex',
  );
  const content = Buffer.concat([
    pssAlgorithm,
    rsaSpki.subarray(bitStringOffset),
  ]);
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x30, 0x82, content.length >> 8, content.length & 0xff]),
      content,
    ]),
  );
}

describe('Blind RSA finalization', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicExponent: 0x10001,
  });
  const rsaSpki = new Uint8Array(
    publicKey.export({ format: 'der', type: 'spki' }),
  );
  const spki = asPrivacyPassIssuerKey(publicKey);
  const privateJwk = privateKey.export({ format: 'jwk' });
  const modulus = decodeJwkInteger(privateJwk.n as string);
  const privateExponent = decodeJwkInteger(privateJwk.d as string);

  it('accepts a correctly signed blinded message', () => {
    const state = generateBlindedMessages(
      spki,
      1,
      new Uint8Array(randomBytes(32)),
    );
    const token = state.tokens[0];
    expect(token).toBeDefined();
    if (!token) {
      throw new Error('Expected one blinded token');
    }
    const blindedMessage = bytesToBigInt(token.blindedMsg);
    const blindSignature = bigIntToBytes(
      modPow(blindedMessage, privateExponent, modulus),
      token.blindedMsg.length,
    );

    const tokens = unblindSignatures(state, [
      Buffer.from(blindSignature).toString('base64url'),
    ]);

    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.raw).toHaveLength(2 + 32 + 32 + 32 + 256);
  });

  it('rejects an invalid blind signature after unblinding', () => {
    const state = generateBlindedMessages(
      spki,
      1,
      new Uint8Array(randomBytes(32)),
    );
    const token = state.tokens[0];
    expect(token).toBeDefined();
    if (!token) {
      throw new Error('Expected one blinded token');
    }
    const invalidSignature = Buffer.alloc(token.blindedMsg.length).toString(
      'base64url',
    );

    expect(() => unblindSignatures(state, [invalidSignature])).toThrow(
      'Blind signature 0 failed verification',
    );
  });

  it('rejects an encoded message that is not coprime to the modulus', () => {
    const evenModulusSpki = spki.slice();
    const modulusBytes = Buffer.from(privateJwk.n as string, 'base64url');
    const modulusOffset = Buffer.from(evenModulusSpki).indexOf(modulusBytes);
    expect(modulusOffset).toBeGreaterThanOrEqual(0);
    const lastModulusByte = modulusOffset + modulusBytes.length - 1;
    const value = evenModulusSpki[lastModulusByte];
    if (value === undefined) throw new Error('Expected RSA modulus bytes');
    evenModulusSpki[lastModulusByte] = value & 0xfe;

    expect(() =>
      generateBlindedMessages(
        evenModulusSpki,
        1,
        new Uint8Array(randomBytes(32)),
      ),
    ).toThrow('not coprime to the RSA modulus');
  });

  it('rejects keys that are not 2048-bit RSA', () => {
    const { publicKey: shortPublicKey } = generateKeyPairSync('rsa-pss', {
      modulusLength: 1024,
      publicExponent: 0x10001,
      hashAlgorithm: 'sha384',
      mgf1HashAlgorithm: 'sha384',
    });
    const shortSpki = new Uint8Array(
      shortPublicKey.export({ format: 'der', type: 'spki' }),
    );

    expect(() =>
      generateBlindedMessages(shortSpki, 1, new Uint8Array(randomBytes(32))),
    ).toThrow('Issuer key must use 2048-bit RSA-PSS');
  });

  it('rejects an RSA key without the required PSS parameters', () => {
    expect(() =>
      generateBlindedMessages(rsaSpki, 1, new Uint8Array(randomBytes(32))),
    ).toThrow('Issuer key must use 2048-bit RSA-PSS');
  });
});
