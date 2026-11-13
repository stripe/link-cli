import {
  createHash,
  createPrivateKey,
  type KeyObject,
  sign,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clearJwksCache,
  createClaimsChallenge,
  LinkIssuer,
  LinkVerifier,
  verifyClaimsPresentation,
} from '@stripe/agent-identity';
import {
  CredentialFixture,
  combineFetch,
  LinkFixture,
} from '@stripe/agent-identity/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LinkConfigurationError, LinkSdkError } from '@/errors';
import {
  type CreatePresentationOptions,
  createPresentation,
  LinkPresentationError,
  type LinkPresentationErrorCode,
  type PresentationHolderKey,
} from '@/resources/presentation';

const subtle = globalThis.crypto.subtle;
const NOW = 1_800_000_000;
const AUD = 'https://merchant.example';
const NONCE = 'challenge-nonce';

/** Deterministic Ed25519 key from a repeated seed byte. */
function seededKey(fill: number): KeyObject {
  return createPrivateKey({
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.alloc(32, fill),
    ]),
    format: 'der',
    type: 'pkcs8',
  });
}

type PrivateJwk = { kty: 'OKP'; crv: 'Ed25519'; x: string; d: string };
const privateJwk = (key: KeyObject) =>
  key.export({ format: 'jwk' }) as PrivateJwk;
const publicJwk = ({ x }: { x: string }) => ({
  kty: 'OKP' as const,
  crv: 'Ed25519' as const,
  x,
});

const holderKey = seededKey(1);
const holderJwk = privateJwk(holderKey);
const otherJwk = privateJwk(seededKey(3));
const issuerKey = seededKey(2);

const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');
const raw = (value: string | Uint8Array) =>
  Buffer.from(value).toString('base64url');
const hash = (value: string) =>
  createHash('sha256').update(value).digest('base64url');
const decode = (value: string) =>
  JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));

// PII sentinels: error messages must never contain these.
const EMAIL = encode(['email-salt', 'email', 'private@example.test']);
const NAME = encode(['name-salt', 'given_name', 'UndisclosedName']);
const PHONE = encode(['phone-salt', 'phone_number', '+15550000000']);
const PII = ['private@example.test', 'UndisclosedName', '+15550000000'];

interface MintOptions {
  header?: unknown;
  headerSegment?: string;
  payload?: Record<string, unknown>;
  payloadSegment?: string;
  disclosures?: string[];
  sd?: unknown;
}

/** Mints a Link-profile credential with node:crypto, independent of the SDK. */
function mint(options: MintOptions = {}): string {
  const disclosures = options.disclosures ?? [EMAIL, NAME, PHONE];
  const payload = {
    iss: 'https://api.link.com',
    vct: 'https://api.link.com/credentials/aap/v1',
    iat: NOW - 60,
    exp: NOW + 3600,
    cnf: { jwk: publicJwk(holderJwk) },
    _sd: options.sd ?? disclosures.map(hash),
    _sd_alg: 'sha-256',
    ...options.payload,
  };
  const input = `${options.headerSegment ?? encode(options.header ?? { typ: 'dc+sd-jwt', alg: 'EdDSA', kid: 'fixture' })}.${options.payloadSegment ?? encode(payload)}`;
  const jwt = `${input}.${sign(null, Buffer.from(input), issuerKey).toString('base64url')}`;
  return `${[jwt, ...disclosures].join('~')}~`;
}

/** The former CLI algorithm, retained as an independent compatibility reference. */
function referencePresentation(
  credential: string,
  key: KeyObject,
  aud: string,
  nonce: string,
  disclose: string[],
  now: number,
): string {
  const [issuerJwt, ...disclosures] = credential.split('~');
  disclosures.pop();
  const byName = new Map(disclosures.map((d) => [decode(d)[1] as string, d]));
  const selected = [...new Set(disclose)].map((name) => byName.get(name));
  const sdPart = `${[issuerJwt, ...selected].join('~')}~`;
  const kbInput = `${encode({ typ: 'kb+jwt', alg: 'EdDSA' })}.${encode({
    aud,
    nonce,
    iat: now,
    sd_hash: hash(sdPart),
  })}`;
  const signature = sign(null, Buffer.from(kbInput), key).toString('base64url');
  return `${sdPart}${kbInput}.${signature}`;
}

function present(overrides: Partial<CreatePresentationOptions> = {}) {
  return createPresentation({
    credential: mint(),
    holderKey: holderJwk,
    aud: AUD,
    nonce: NONCE,
    disclose: ['email'],
    now: () => NOW,
    ...overrides,
  });
}

async function presentationError(
  promise: Promise<unknown>,
): Promise<LinkPresentationError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(LinkPresentationError);
  return error as LinkPresentationError;
}

const importSigningKey = (jwk: PrivateJwk, extractable = false) =>
  subtle.importKey('jwk', jwk, { name: 'Ed25519' }, extractable, ['sign']);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('byte-for-byte compatibility with the node:crypto implementation', () => {
  const unicodeDisclosure = encode([
    'unicode-salt',
    'address',
    'Zürich 東京 🚀',
  ]);
  it.each<{
    name: string;
    mint?: MintOptions;
    aud?: string;
    nonce?: string;
    disclose: string[];
  }>([
    { name: 'one claim', disclose: ['email'] },
    { name: 'all claims', disclose: ['email', 'given_name', 'phone_number'] },
    {
      name: 'requested order with duplicates ignored',
      disclose: ['phone_number', 'email', 'email', 'phone_number'],
    },
    {
      name: 'exact audience and unicode nonce',
      aud: 'https://directory.example:443/path/',
      nonce: 'challenge+/=with unicode é and "quotes"',
      disclose: ['given_name'],
    },
    {
      name: 'vc+sd-jwt type and default _sd_alg',
      mint: {
        header: { typ: 'vc+sd-jwt', alg: 'EdDSA' },
        payload: { _sd_alg: undefined },
      },
      disclose: ['email'],
    },
    {
      name: 'audience-restricted credential naming this audience',
      mint: { payload: { aud: ['https://other.example', AUD], nbf: NOW } },
      disclose: ['email'],
    },
    {
      name: 'optional profile members',
      mint: {
        payload: {
          status: { status_list: { idx: 1, uri: 'https://x.example' } },
          'vct#integrity': 'sha256-abc',
        },
      },
      disclose: ['email'],
    },
    {
      name: 'unicode disclosure value',
      mint: { disclosures: [EMAIL, unicodeDisclosure] },
      disclose: ['address', 'email'],
    },
  ])('$name', async (row) => {
    const credential = mint(row.mint);
    const aud = row.aud ?? AUD;
    const nonce = row.nonce ?? NONCE;
    const expected = referencePresentation(
      credential,
      holderKey,
      aud,
      nonce,
      row.disclose,
      NOW,
    );
    const keys: PresentationHolderKey[] = [
      holderJwk,
      await importSigningKey(holderJwk),
    ];
    for (const key of keys) {
      await expect(
        createPresentation({
          credential,
          holderKey: key,
          aud,
          nonce,
          disclose: row.disclose,
          now: () => NOW,
        }),
      ).resolves.toBe(expected);
    }
  });

  it('emits the exact KB-JWT header and payload member order', async () => {
    const presentation = await present();
    const kb = presentation.split('~').at(-1) as string;
    const [header, payload] = kb.split('.') as [string, string];
    expect(Buffer.from(header, 'base64url').toString()).toBe(
      '{"typ":"kb+jwt","alg":"EdDSA"}',
    );
    const sdPart = presentation.slice(0, presentation.lastIndexOf('~') + 1);
    expect(Buffer.from(payload, 'base64url').toString()).toBe(
      JSON.stringify({
        aud: AUD,
        nonce: NONCE,
        iat: NOW,
        sd_hash: hash(sdPart),
      }),
    );
  });

  it('defaults iat to the system clock in whole seconds', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW * 1000 + 999);
    const presentation = await createPresentation({
      credential: mint(),
      holderKey: holderJwk,
      aud: AUD,
      nonce: NONCE,
      disclose: ['email'],
    });
    const kb = presentation.split('~').at(-1) as string;
    expect(decode(kb.split('.')[1] as string).iat).toBe(NOW);
  });
});

describe('round trip through @stripe/agent-identity', () => {
  async function setup(claims: Record<string, unknown>) {
    clearJwksCache();
    const holder = (await subtle.generateKey({ name: 'Ed25519' }, false, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const exported = await subtle.exportKey('jwk', holder.publicKey);
    // CredentialFixture mints with iss = issuerUrl, so Link's production
    // origin is used with fixture fetch implementations; nothing reaches the
    // network. cnf is overridden to bind a holder key this test controls.
    const link = await LinkFixture.create('https://api.link.com', 1);
    const fixture = await CredentialFixture.create({
      issuerUrl: 'https://api.link.com',
      claims,
      extraPayload: { cnf: { jwk: publicJwk(exported as { x: string }) } },
    });
    const fetchImpl = combineFetch(link.fetchImpl(), fixture.fetchImpl());
    const issuer = new LinkIssuer({ fetchImpl, minRefreshSeconds: 0 });
    const challenge = await createClaimsChallenge(issuer, {
      audience: AUD,
      claims: Object.keys(claims),
    });
    return {
      credential: `${[fixture.issuerJwt, ...fixture.disclosures].join('~')}~`,
      holderKey: holder.privateKey,
      fetchImpl,
      issuer,
      nonce: challenge.nonce,
    };
  }

  const claims = {
    email: 'ada@example.test',
    given_name: 'Ada',
    phone_number: '+15550000000',
  };

  it('verifies with verifyClaimsPresentation and discloses only the selection', async () => {
    const ctx = await setup(claims);
    const presentation = await createPresentation({
      credential: ctx.credential,
      holderKey: ctx.holderKey,
      aud: AUD,
      nonce: ctx.nonce,
      disclose: ['email', 'phone_number'],
    });
    const result = await verifyClaimsPresentation({
      presentation,
      audience: AUD,
      nonce: ctx.nonce,
      issuer: ctx.issuer,
      fetchImpl: ctx.fetchImpl,
      requiredClaims: ['email', 'phone_number'],
    });
    expect(result).toMatchObject({
      valid: true,
      claims: { email: claims.email, phone_number: claims.phone_number },
    });
    expect(result.valid && result.claims).not.toHaveProperty('given_name');
  });

  it('verifies with LinkVerifier.verifyClaims', async () => {
    const ctx = await setup(claims);
    const verifier = new LinkVerifier({
      origin: 'merchant.example',
      fetchImpl: ctx.fetchImpl,
    });
    const { nonce } = await verifier.claimsChallenge({ claims: ['email'] });
    const presentation = await createPresentation({
      credential: ctx.credential,
      holderKey: ctx.holderKey,
      aud: AUD,
      nonce,
      disclose: ['email'],
    });
    await expect(
      verifier.verifyClaims(presentation, { nonce, requiredClaims: ['email'] }),
    ).resolves.toMatchObject({ valid: true, claims: { email: claims.email } });
  });

  async function rejection(
    mutate: (
      presentation: string,
      ctx: Awaited<ReturnType<typeof setup>>,
    ) => {
      presentation: string;
      audience?: string;
      nonce?: string;
    },
  ) {
    const ctx = await setup(claims);
    const presentation = await createPresentation({
      credential: ctx.credential,
      holderKey: ctx.holderKey,
      aud: AUD,
      nonce: ctx.nonce,
      disclose: ['email', 'given_name'],
    });
    const changed = mutate(presentation, ctx);
    const result = await verifyClaimsPresentation({
      presentation: changed.presentation,
      audience: changed.audience ?? AUD,
      nonce: changed.nonce ?? ctx.nonce,
      issuer: ctx.issuer,
      fetchImpl: ctx.fetchImpl,
      requiredClaims: [],
    });
    expect(result.valid).toBe(false);
    return result.valid ? '' : (result.failures[0]?.message ?? '');
  }

  const replaceKbPayload = (
    presentation: string,
    change: (payload: Record<string, unknown>) => void,
  ) => {
    const parts = presentation.split('~');
    const [header, payload, signature] = (parts.pop() as string).split('.');
    const decoded = decode(payload as string);
    change(decoded);
    return [...parts, `${header}.${encode(decoded)}.${signature}`].join('~');
  };

  it.each<{
    name: string;
    mutate: Parameters<typeof rejection>[0];
    message: RegExp;
  }>([
    {
      name: 'a tampered disclosure',
      mutate: (p) => {
        const parts = p.split('~');
        parts[1] = encode([...decode(parts[1] as string).slice(0, 2), 'x']);
        return { presentation: parts.join('~') };
      },
      message: /not committed/,
    },
    {
      name: 'a dropped disclosure',
      mutate: (p) => {
        const parts = p.split('~');
        parts.splice(2, 1);
        return { presentation: parts.join('~') };
      },
      message: /sd_hash/,
    },
    {
      name: 'an added committed disclosure',
      mutate: (p, ctx) => {
        const parts = p.split('~');
        const extra = ctx.credential.split('~')[3] as string;
        parts.splice(1, 0, extra);
        return { presentation: parts.join('~') };
      },
      message: /sd_hash/,
    },
    {
      name: 'a different audience',
      mutate: (p) => ({ presentation: p, audience: 'https://other.example' }),
      message: /aud/,
    },
    {
      name: 'a different nonce',
      mutate: (p) => ({ presentation: p, nonce: 'other-nonce' }),
      message: /nonce/,
    },
    {
      name: 'a rewritten sd_hash',
      mutate: (p) => ({
        presentation: replaceKbPayload(p, (payload) => {
          payload.sd_hash = hash('other');
        }),
      }),
      message: /sd_hash/,
    },
    {
      name: 'a rewritten aud without re-signing',
      mutate: (p) => ({
        presentation: replaceKbPayload(p, (payload) => {
          payload.aud = 'https://other.example';
        }),
        audience: 'https://other.example',
      }),
      message: /signature/,
    },
  ])('is rejected after $name', async ({ mutate, message }) => {
    expect(await rejection(mutate)).toMatch(message);
  });
});

describe('holder key forms', () => {
  it.each<{
    name: string;
    key: () => Promise<PresentationHolderKey> | PrivateJwk;
  }>([
    { name: 'private JWK', key: () => holderJwk },
    {
      name: 'private JWK with extra members',
      key: () => ({ ...holderJwk, alg: 'EdDSA', kid: 'k', use: 'sig' }),
    },
    {
      name: 'non-extractable CryptoKey',
      key: () => importSigningKey(holderJwk),
    },
    {
      name: 'extractable CryptoKey',
      key: () => importSigningKey(holderJwk, true),
    },
  ])('accepts a $name', async ({ key }) => {
    const expected = referencePresentation(
      mint(),
      holderKey,
      AUD,
      NONCE,
      ['email'],
      NOW,
    );
    await expect(present({ holderKey: await key() })).resolves.toBe(expected);
  });

  it.each([
    ['sync function returning a JWK', () => holderJwk],
    ['async function returning a JWK', async () => holderJwk],
    ['sync function returning a CryptoKey', () => importSigningKey(holderJwk)],
    [
      'async function returning a CryptoKey',
      async () => importSigningKey(holderJwk),
    ],
  ])('accepts a %s', async (_name, factory) => {
    const resolver = vi.fn(factory);
    await expect(present({ holderKey: resolver })).resolves.toContain('~');
    expect(resolver).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'the credential is invalid',
      { credential: mint({ payload: { exp: NOW } }) },
    ],
    ['a requested claim is unavailable', { disclose: ['address'] }],
    [
      'cnf.jwk is unsupported',
      { credential: mint({ payload: { cnf: { jwk: { kty: 'EC' } } } }) },
    ],
  ])(
    'does not call the holder key function when %s',
    async (_name, overrides) => {
      const resolver = vi.fn(() => holderJwk);
      await expect(
        present({ ...overrides, holderKey: resolver }),
      ).rejects.toThrow(LinkPresentationError);
      expect(resolver).not.toHaveBeenCalled();
    },
  );

  it('does not call the holder key function for invalid arguments', async () => {
    const resolver = vi.fn(() => holderJwk);
    await expect(present({ aud: '', holderKey: resolver })).rejects.toThrow(
      LinkConfigurationError,
    );
    expect(resolver).not.toHaveBeenCalled();
  });

  it('propagates errors thrown by the holder key function unchanged', async () => {
    const failure = new Error('key store locked');
    await expect(
      present({
        holderKey: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
  });
});

describe('errors', () => {
  const header = encode({ typ: 'dc+sd-jwt', alg: 'EdDSA' });
  const payload = encode({
    iss: 'https://api.link.com',
    vct: 'v',
    exp: NOW + 60,
    cnf: { jwk: publicJwk(holderJwk) },
  });
  const BOM = Uint8Array.from([0xef, 0xbb, 0xbf, ...Buffer.from('{}')]);

  type Row = [
    LinkPresentationErrorCode,
    string,
    () =>
      | Partial<CreatePresentationOptions>
      | Promise<Partial<CreatePresentationOptions>>,
  ];
  const rows: Row[] = [
    ['invalid_credential', 'no tilde', () => ({ credential: 'a.b.c' })],
    ['invalid_credential', 'empty issuer JWT', () => ({ credential: '~' })],
    ['invalid_credential', 'empty string', () => ({ credential: '' })],
    [
      'invalid_credential',
      'trailing Key Binding JWT',
      () => ({ credential: `${mint()}kb.jwt.sig` }),
    ],
    [
      'invalid_credential',
      'not a string',
      () => ({ credential: 42 as unknown as string }),
    ],
    ['invalid_issuer_jwt', 'two segments', () => ({ credential: 'a.b~' })],
    ['invalid_issuer_jwt', 'four segments', () => ({ credential: 'a.b.c.d~' })],
    ['invalid_issuer_jwt', 'empty segment', () => ({ credential: 'a..c~' })],
    ['invalid_issuer_jwt', 'padding', () => ({ credential: 'e30=.e30.c~' })],
    [
      'invalid_base64url_json',
      'header is not JSON',
      () => ({ credential: mint({ headerSegment: raw('not json') }) }),
    ],
    [
      'invalid_base64url_json',
      'payload is not JSON',
      () => ({ credential: mint({ payloadSegment: raw('{"email":') }) }),
    ],
    [
      'invalid_base64url_json',
      'non-canonical trailing bits',
      () => ({ credential: `e31.${payload}.c~` }),
    ],
    [
      'invalid_base64url_json',
      'length 1 mod 4',
      () => ({ credential: `${header}A.${payload}.c~` }),
    ],
    [
      'invalid_base64url_json',
      'BOM-prefixed header',
      () => ({ credential: `${raw(BOM)}.${payload}.c~` }),
    ],
    [
      'invalid_base64url_json',
      'disclosure is not JSON',
      () => ({
        credential: mint({ disclosures: [raw('private@example.test')] }),
      }),
    ],
    [
      'invalid_base64url_json',
      'empty disclosure',
      () => ({ credential: mint().replace(/~$/, '~~') }),
    ],
    [
      'unsupported_profile',
      'header typ JWT',
      () => ({ credential: mint({ header: { typ: 'JWT', alg: 'EdDSA' } }) }),
    ],
    [
      'unsupported_profile',
      'header is an array',
      () => ({ credential: mint({ header: ['dc+sd-jwt'] }) }),
    ],
    [
      'unsupported_profile',
      'other issuer',
      () => ({
        credential: mint({ payload: { iss: 'https://evil.example' } }),
      }),
    ],
    [
      'unsupported_profile',
      'plaintext user claim',
      () => ({
        credential: mint({ payload: { email: 'private@example.test' } }),
      }),
    ],
    [
      'unsupported_profile',
      'missing exp',
      () => ({ credential: mint({ payload: { exp: undefined } }) }),
    ],
    [
      'unsupported_profile',
      'fractional exp',
      () => ({ credential: mint({ payload: { exp: NOW + 0.5 } }) }),
    ],
    [
      'unsupported_profile',
      'sha-512 digests',
      () => ({ credential: mint({ payload: { _sd_alg: 'sha-512' } }) }),
    ],
    [
      'unsupported_profile',
      'non-string digest',
      () => ({ credential: mint({ sd: [1] }) }),
    ],
    [
      'unsupported_profile',
      'empty audience array',
      () => ({ credential: mint({ payload: { aud: [] } }) }),
    ],
    [
      'unsupported_profile',
      'extra cnf member',
      () => ({
        credential: mint({
          payload: { cnf: { jwk: publicJwk(holderJwk), kid: 'k' } },
        }),
      }),
    ],
    [
      'unsupported_profile',
      'non-Ed25519 cnf.jwk',
      () => ({
        credential: mint({
          payload: {
            cnf: { jwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' } },
          },
        }),
      }),
    ],
    [
      'unsupported_profile',
      'missing cnf.jwk',
      () => ({ credential: mint({ payload: { cnf: {} } }) }),
    ],
    [
      'credential_expired',
      'exp equal to now',
      () => ({ credential: mint({ payload: { exp: NOW } }) }),
    ],
    [
      'credential_expired',
      'exp in the past',
      () => ({ credential: mint({ payload: { exp: NOW - 1 } }) }),
    ],
    [
      'credential_not_yet_valid',
      'nbf in the future',
      () => ({ credential: mint({ payload: { nbf: NOW + 1 } }) }),
    ],
    [
      'audience_restricted',
      'string aud',
      () => ({
        credential: mint({ payload: { aud: 'https://other.example' } }),
      }),
    ],
    [
      'audience_restricted',
      'array aud',
      () => ({
        credential: mint({ payload: { aud: ['https://other.example'] } }),
      }),
    ],
    [
      'duplicate_commitments',
      'repeated digest',
      () => ({ credential: mint({ sd: [hash(EMAIL), hash(EMAIL)] }) }),
    ],
    [
      'nested_disclosure',
      '_sd under status',
      () => ({ credential: mint({ payload: { status: { _sd: [] } } }) }),
    ],
    [
      'nested_disclosure',
      'array element digest under status',
      () => ({
        credential: mint({ payload: { status: { list: [{ '...': 'd' }] } } }),
      }),
    ],
    [
      'nested_disclosure',
      '_sd under cnf.jwk',
      () => ({
        credential: mint({
          payload: { cnf: { jwk: { ...publicJwk(holderJwk), _sd: [] } } },
        }),
      }),
    ],
    [
      'nested_disclosure',
      'disclosed value with _sd',
      () => ({
        credential: mint({
          disclosures: [encode(['s', 'address', { _sd: ['d'] }])],
        }),
      }),
    ],
    [
      'nested_disclosure',
      'disclosed array with digest element',
      () => ({
        credential: mint({
          disclosures: [encode(['s', 'nationalities', [{ '...': 'd' }]])],
        }),
      }),
    ],
    [
      'invalid_disclosure',
      'uncommitted disclosure',
      () => ({ credential: mint({ sd: [] }) }),
    ],
    [
      'invalid_disclosure',
      'array-element disclosure',
      () => ({
        credential: mint({ disclosures: [encode(['salt', 'value'])] }),
      }),
    ],
    [
      'invalid_disclosure',
      'non-string claim name',
      () => ({ credential: mint({ disclosures: [encode(['salt', 1, 'v'])] }) }),
    ],
    [
      'invalid_disclosure',
      'empty salt',
      () => ({
        credential: mint({ disclosures: [encode(['', 'email', 'v'])] }),
      }),
    ],
    [
      'invalid_disclosure',
      'four-element disclosure',
      () => ({
        credential: mint({ disclosures: [encode(['s', 'email', 'v', 'x'])] }),
      }),
    ],
    [
      'invalid_disclosure',
      'object disclosure',
      () => ({
        credential: mint({ disclosures: [encode({ name: 'email' })] }),
      }),
    ],
    ...(['exp', 'iat', 'cnf', '_sd', 'vct#integrity', '...'] as const).map(
      (name): Row => [
        'reserved_or_duplicate_claim',
        `reserved name ${name}`,
        () => ({
          credential: mint({ disclosures: [encode(['salt', name, 'v'])] }),
        }),
      ],
    ),
    [
      'reserved_or_duplicate_claim',
      'duplicate claim name',
      () => ({
        credential: mint({
          disclosures: [
            EMAIL,
            encode(['other', 'email', 'other@example.test']),
          ],
        }),
      }),
    ],
    [
      'claim_unavailable',
      'claim not in the credential',
      () => ({ disclose: ['email', 'address'] }),
    ],
    [
      'claim_unavailable',
      'prototype member name',
      () => ({ disclose: ['__proto__'] }),
    ],
    [
      'invalid_holder_key',
      'public CryptoKey',
      async () => ({
        holderKey: await subtle.importKey(
          'jwk',
          publicJwk(holderJwk),
          { name: 'Ed25519' },
          true,
          ['verify'],
        ),
      }),
    ],
    [
      'invalid_holder_key',
      'ECDSA CryptoKey',
      async () => ({
        holderKey: (
          (await subtle.generateKey(
            { name: 'ECDSA', namedCurve: 'P-256' },
            false,
            ['sign'],
          )) as CryptoKeyPair
        ).privateKey,
      }),
    ],
    [
      'invalid_holder_key',
      'public JWK without d',
      () => ({ holderKey: publicJwk(holderJwk) }),
    ],
    [
      'invalid_holder_key',
      'EC JWK',
      () => ({
        holderKey: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y', d: 'd' },
      }),
    ],
    [
      'invalid_holder_key',
      'unimportable d',
      () => ({ holderKey: { ...holderJwk, d: 'AAAA' } }),
    ],
    [
      'invalid_holder_key',
      'non-key value from a function',
      () => ({
        holderKey: () => 'not a key' as unknown as PresentationHolderKey,
      }),
    ],
    [
      'invalid_holder_key',
      'null',
      () => ({ holderKey: null as unknown as PresentationHolderKey }),
    ],
    ['holder_key_mismatch', 'different JWK', () => ({ holderKey: otherJwk })],
    [
      'holder_key_mismatch',
      'different non-extractable CryptoKey',
      async () => ({ holderKey: await importSigningKey(otherJwk) }),
    ],
    [
      'holder_key_mismatch',
      'malformed cnf.jwk x with a CryptoKey',
      async () => ({
        credential: mint({
          payload: { cnf: { jwk: { kty: 'OKP', crv: 'Ed25519', x: 'AAAA' } } },
        }),
        holderKey: await importSigningKey(holderJwk),
      }),
    ],
    [
      'holder_key_mismatch',
      'malformed cnf.jwk x with a JWK',
      () => ({
        credential: mint({
          payload: { cnf: { jwk: { kty: 'OKP', crv: 'Ed25519', x: 'AAAA' } } },
        }),
      }),
    ],
  ];

  it.each(rows)('%s: %s', async (code, _name, overrides) => {
    const error = await presentationError(present(await overrides()));
    expect(error.code).toBe(code);
    expect(error.name).toBe('LinkPresentationError');
    expect(error).toBeInstanceOf(LinkSdkError);
    for (const value of PII) expect(error.message).not.toContain(value);
  });

  it('reaches every error code', () => {
    const codes: Record<LinkPresentationErrorCode, true> = {
      invalid_credential: true,
      invalid_issuer_jwt: true,
      invalid_base64url_json: true,
      unsupported_profile: true,
      credential_expired: true,
      credential_not_yet_valid: true,
      audience_restricted: true,
      duplicate_commitments: true,
      nested_disclosure: true,
      invalid_disclosure: true,
      reserved_or_duplicate_claim: true,
      claim_unavailable: true,
      invalid_holder_key: true,
      holder_key_mismatch: true,
    };
    expect(new Set(rows.map(([code]) => code))).toEqual(
      new Set(Object.keys(codes)),
    );
  });

  it('names the unavailable claim', async () => {
    const error = await presentationError(
      present({ disclose: ['email', 'address'] }),
    );
    expect(error.claim).toBe('address');
    expect(error.message).toBe(
      'Requested claim is not available for selective disclosure: address',
    );
    const other = await presentationError(present({ credential: '~' }));
    expect(other).not.toHaveProperty('claim', expect.anything());
  });

  it('keeps the cnf.jwk parse error as the cause', async () => {
    const error = await presentationError(
      present({ credential: mint({ payload: { cnf: { jwk: { kty: 1 } } } }) }),
    );
    expect(error.cause).toBeInstanceOf(LinkConfigurationError);
    expect((error.cause as Error).message).toBe(
      'Holder public key is missing kty',
    );
  });

  it('rejects a JWK whose x does not belong to its d', async () => {
    // Node's Web Crypto rejects the inconsistent JWK on import; runtimes that
    // accept it fail the post-signing verification instead.
    const error = await presentationError(
      present({ holderKey: { ...otherJwk, x: holderJwk.x } }),
    );
    expect(['invalid_holder_key', 'holder_key_mismatch']).toContain(error.code);
  });

  it.each<[string, Partial<CreatePresentationOptions>]>([
    ['empty aud', { aud: '' }],
    ['non-string aud', { aud: 1 as unknown as string }],
    ['empty nonce', { nonce: '' }],
    ['non-string nonce', { nonce: undefined as unknown as string }],
    ['empty disclose', { disclose: [] }],
    ['empty claim name', { disclose: ['email', ''] }],
    ['non-array disclose', { disclose: 'email' as unknown as string[] }],
    ['non-finite now', { now: () => Number.NaN }],
  ])('throws LinkConfigurationError for %s', async (_name, overrides) => {
    await expect(present(overrides)).rejects.toThrow(LinkConfigurationError);
  });
});

describe('runtime neutrality', () => {
  const resources = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const src = resolve(resources, '..');

  function resolveLocal(from: string, specifier: string): string | undefined {
    const base = specifier.startsWith('@/')
      ? resolve(src, specifier.slice(2))
      : specifier.startsWith('.')
        ? resolve(dirname(from), specifier)
        : undefined;
    return base && `${base.replace(/\.js$/, '')}.ts`;
  }

  function importGraph(entries: string[]): string[] {
    const seen = new Set<string>();
    const pending = [...entries];
    while (pending.length > 0) {
      const file = pending.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(
        /\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g,
      )) {
        const specifier = match[1] ?? match[2];
        const local = specifier && resolveLocal(file, specifier);
        if (local) pending.push(local);
      }
    }
    return [...seen].sort();
  }

  const graph = importGraph([
    resolve(resources, 'presentation.ts'),
    resolve(src, 'internal/identity/holder-jwk-parse.ts'),
  ]);

  it('follows local imports', () => {
    expect(graph).toEqual(
      expect.arrayContaining([
        resolve(resources, 'presentation.ts'),
        resolve(src, 'internal/identity/holder-jwk-parse.ts'),
        resolve(src, 'internal/identity/base64url.ts'),
        resolve(src, 'errors.ts'),
      ]),
    );
    expect(graph).not.toContain(resolve(resources, 'holder-jwk.ts'));
  });

  it.each(graph.map((file) => [file.slice(src.length + 1), file]))(
    '%s uses no node: modules or Buffer',
    (_name, file) => {
      const source = readFileSync(file as string, 'utf8');
      expect(source).not.toMatch(/['"]node:/);
      expect(source).not.toMatch(/\brequire\s*\(/);
      expect(source).not.toMatch(/\bBuffer\b/);
    },
  );
});
