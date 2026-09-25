import type { KeyObject } from 'node:crypto';
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HolderPublicJwk } from '@/resources/interfaces';
import { createIdentityPresentation } from '../presentation';

const now = 1_800_000_000;
const audience = 'https://merchant.example';
const nonce = 'challenge-nonce';
const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');
const decode = (value: string) =>
  JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
const hash = (value: string) =>
  createHash('sha256').update(value).digest('base64url');

let holder: { publicKey: KeyObject; privateKey: KeyObject };
let holderPublicJwk: HolderPublicJwk;
let disclosures: string[];
let payload: Record<string, unknown>;

function credential(): string {
  const issuerInput = `${encode({ typ: 'dc+sd-jwt', alg: 'EdDSA' })}.${encode(payload)}`;
  return `${issuerInput}.issuer-signature~${disclosures.join('~')}~`;
}

function create(
  overrides: Partial<Parameters<typeof createIdentityPresentation>[0]> = {},
) {
  return createIdentityPresentation({
    credential: credential(),
    holderPublicJwk,
    audience,
    nonce,
    claims: ['email'],
    sign: (input) => sign(null, input, holder.privateKey),
    now,
    ...overrides,
  });
}

beforeEach(() => {
  holder = generateKeyPairSync('ed25519');
  holderPublicJwk = holder.publicKey.export({
    format: 'jwk',
  }) as HolderPublicJwk;
  disclosures = [
    encode(['email-salt', 'email', 'private@example.test']),
    encode(['name-salt', 'given_name', 'UndisclosedName']),
  ];
  payload = {
    iss: 'https://api.link.com',
    vct: 'https://api.link.com/credentials/aap/v1',
    iat: now - 60,
    exp: now + 3600,
    cnf: { jwk: holderPublicJwk },
    _sd: disclosures.map(hash),
    _sd_alg: 'sha-256',
  };
});

describe('createIdentityPresentation', () => {
  it('selects exact disclosures and creates a verifiable holder binding', async () => {
    const presentation = await create();
    const [jwt, disclosure, kb] = presentation.split('~');
    expect(disclosure).toBe(disclosures[0]);
    expect(presentation).not.toContain(disclosures[1] as string);

    const [header, body, signature] = (kb as string).split('.');
    expect(decode(header as string)).toEqual({ typ: 'kb+jwt', alg: 'EdDSA' });
    expect(decode(body as string)).toEqual({
      aud: audience,
      nonce,
      iat: now,
      sd_hash: hash(`${jwt}~${disclosure}~`),
    });
    expect(
      verify(
        null,
        Buffer.from(`${header}.${body}`),
        createPublicKey({ key: holderPublicJwk, format: 'jwk' }),
        Buffer.from(signature as string, 'base64url'),
      ),
    ).toBe(true);
  });

  it('deduplicates requested claims while preserving their order and bytes', async () => {
    const presentation = await create({
      claims: ['given_name', 'email', 'email'],
    });
    expect(presentation.split('~').slice(1, -1)).toEqual([
      disclosures[1],
      disclosures[0],
    ]);
  });

  it.each([
    ['expired', { exp: now }, 'expired'],
    ['not yet valid', { nbf: now + 60 }, 'not yet valid'],
    ['wrong issuer', { iss: 'https://issuer.example' }, 'supported Link'],
    ['plaintext claim', { email: 'private@example.test' }, 'supported Link'],
  ])('rejects a credential that is %s', async (_name, changes, message) => {
    Object.assign(payload, changes);
    await expect(create()).rejects.toThrow(message as string);
  });

  it('rejects uncommitted and unavailable disclosures', async () => {
    payload._sd = [hash(disclosures[1] as string)];
    await expect(create()).rejects.toThrow(/uncommitted/);

    payload._sd = disclosures.map(hash);
    await expect(create({ claims: ['address'] })).rejects.toThrow(
      /not available/,
    );
  });

  it('rejects a holder key other than the credential cnf.jwk', async () => {
    const different = generateKeyPairSync('ed25519').publicKey.export({
      format: 'jwk',
    }) as HolderPublicJwk;
    await expect(create({ holderPublicJwk: different })).rejects.toThrow(
      /does not match/,
    );
  });

  it('supports an asynchronous signer', async () => {
    const signer = vi.fn(async (input: Uint8Array) =>
      sign(null, input, holder.privateKey),
    );
    await expect(create({ sign: signer })).resolves.toContain('~');
    expect(signer).toHaveBeenCalledOnce();
  });
});
