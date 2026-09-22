import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIdentityCredentialsCli } from '..';
import { loadOrCreateHolderKey } from '../holder-key';
import type { IdentityCredentialIssueResult } from '../issue';
import { presentOpenId4VpChallenge } from '../openid4vp';
import { presentIdentityCredential } from '../present';
import { presentX401Resource } from '../x401';

const now = 1_800_000_000;
const options = {
  aud: 'https://directory.example',
  nonce: 'challenge-nonce',
  claim: ['email'],
};
const issuer = generateKeyPairSync('ed25519');
const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');
const decode = (value: string) =>
  JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
const hash = (value: string) =>
  createHash('sha256').update(value).digest('base64url');

let directory: string;
let file: string;
let keyFile: string;
let payload: Record<string, unknown>;
let disclosures: string[];
let artifact: IdentityCredentialIssueResult;

async function save() {
  const issuerInput = `${encode({ typ: 'dc+sd-jwt', alg: 'EdDSA', kid: 'fixture' })}.${encode(payload)}`;
  const jwt = `${issuerInput}.${sign(null, Buffer.from(issuerInput), issuer.privateKey).toString('base64url')}`;
  artifact.credential = `${[jwt, ...disclosures].join('~')}~`;
  await fs.writeFile(file, JSON.stringify(artifact), { mode: 0o600 });
}

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'link-present-'));
  vi.spyOn(os, 'homedir').mockReturnValue(directory);
  vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
  const store = path.join(directory, '.link-cli', 'credentials');
  await fs.mkdir(store, { recursive: true });
  file = path.join(store, 'current.json');
  keyFile = path.join(directory, '.link', 'holder-key.jwk');
  const holder = loadOrCreateHolderKey(keyFile);
  disclosures = [
    encode(['email-salt', 'email', 'private@example.test']),
    encode(['name-salt', 'given_name', 'UndisclosedName']),
    encode(['phone-salt', 'phone_number', '+15550000000']),
  ];
  payload = {
    iss: 'https://api.link.com',
    vct: 'https://api.link.com/credentials/aap/v1',
    iat: now - 60,
    exp: now + 3600,
    cnf: { jwk: holder.publicJwk },
    _sd: disclosures.map(hash),
    _sd_alg: 'sha-256',
  };
  artifact = {
    version: 1,
    credential: '',
    issuer: 'https://api.link.com',
    expires_at: new Date((now + 3600) * 1000).toISOString(),
    holder: {
      jwk: holder.publicJwk,
      path: keyFile,
      thumbprint: 'cached-value',
      created: true,
    },
    claims: { email: 'incorrect-cached-value@example.test' },
  };
  await save();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await fs.rm(directory, { recursive: true, force: true });
});

function openId4VpChallenge(
  changes: Record<string, unknown> = {},
): Record<string, unknown> {
  const responseUri =
    'https://verifier.example/openid4vp/response?request_id=request-secret';
  return {
    client_id: `redirect_uri:${responseUri}`,
    response_uri: responseUri,
    response_type: 'vp_token',
    response_mode: 'direct_post',
    nonce: 'openid4vp-nonce',
    state: 'openid4vp-state',
    dcql_query: {
      credentials: [
        {
          id: 'link_identity',
          format: 'dc+sd-jwt',
          meta: {
            vct_values: ['https://api.link.com/credentials/aap/v1'],
          },
          claims: [{ path: ['email'] }],
        },
      ],
    },
    client_metadata: { vp_formats_supported: { 'dc+sd-jwt': {} } },
    ...changes,
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function x401Payload() {
  return {
    scheme: 'x401',
    version: '0.2.0',
    credential_requirements: {
      digital: {
        requests: [
          {
            protocol: 'openid4vp-v1-unsigned',
            data: {
              response_type: 'vp_token',
              response_mode: 'dc_api',
              nonce: 'x401-nonce',
              dcql_query: {
                credentials: [
                  {
                    id: 'link_identity',
                    format: 'dc+sd-jwt',
                    meta: {
                      vct_values: ['https://api.link.com/credentials/aap/v1'],
                    },
                    claims: [{ path: ['email'] }],
                  },
                ],
              },
              client_metadata: {
                vp_formats_supported: { 'dc+sd-jwt': {} },
              },
            },
          },
        ],
      },
    },
    request_id: 'link-email-proof-v1',
    satisfied_requirements: ['urn:link:identity:email'],
  };
}

function x401ChallengeResponse(): Response {
  return new Response(JSON.stringify({ error: 'proof_required' }), {
    status: 401,
    headers: { 'PROOF-REQUEST': encode(x401Payload()) },
  });
}

it('discloses only email and binds the exact SD-JWT bytes, audience, nonce, and time', async () => {
  const before = await fs.readFile(file);
  const keyBefore = await fs.readFile(keyFile);
  const { presentation } = await presentIdentityCredential(options);
  const [jwt, disclosure, kb] = presentation.split('~');
  expect(jwt).toBe(artifact.credential.split('~')[0]);
  expect(disclosure).toBe(disclosures[0]);
  expect(decode(disclosure)).toEqual([
    'email-salt',
    'email',
    'private@example.test',
  ]);
  expect(presentation.split('~')).toHaveLength(3);
  expect(presentation).not.toContain(disclosures[1]);
  expect(presentation).not.toContain(disclosures[2]);
  const [header, body, signature] = kb.split('.');
  expect(decode(header)).toEqual({ typ: 'kb+jwt', alg: 'EdDSA' });
  expect(decode(body)).toEqual({
    aud: options.aud,
    nonce: options.nonce,
    iat: now,
    sd_hash: hash(`${jwt}~${disclosure}~`),
  });
  const publicKey = createPublicKey({
    key: artifact.holder.jwk,
    format: 'jwk',
  });
  expect(
    verify(
      null,
      Buffer.from(`${header}.${body}`),
      publicKey,
      Buffer.from(signature, 'base64url'),
    ),
  ).toBe(true);
  expect(await fs.readFile(file)).toEqual(before);
  expect(await fs.readFile(keyFile)).toEqual(keyBefore);
});

it('supports repeated claims, removes duplicates, and keeps encoded disclosure bytes unchanged', async () => {
  const { presentation } = await presentIdentityCredential({
    ...options,
    claim: ['phone_number', 'email', 'email'],
  });
  expect(presentation.split('~').slice(1, -1)).toEqual([
    disclosures[2],
    disclosures[0],
  ]);
});

it('preserves the exact audience and nonce and supports the default SHA-256 algorithm', async () => {
  delete payload._sd_alg;
  await save();
  const aud = 'https://directory.example:443/path/';
  const nonce = 'challenge+/=with unicode é';
  const { presentation } = await presentIdentityCredential({
    ...options,
    aud,
    nonce,
  });
  const kb = presentation.split('~').at(-1) as string;
  expect(decode(kb.split('.')[1])).toMatchObject({ aud, nonce });
});

it('adapts an OpenID4VP DCQL challenge without changing the signer', async () => {
  const challenge = openId4VpChallenge();
  const fetchImpl = vi.fn(async () => jsonResponse(challenge));
  const result = await presentOpenId4VpChallenge(
    { challengeUrl: 'https://verifier.example/openid4vp/challenge' },
    fetchImpl,
  );

  expect(result).toMatchObject({
    protocol: 'openid4vp',
    response_uri: challenge.response_uri,
    content_type: 'application/x-www-form-urlencoded',
  });
  expect(fetchImpl).toHaveBeenCalledOnce();
  const authorizationResponse = result.authorization_response;
  expect(authorizationResponse).toBeDefined();
  if (!authorizationResponse) return;
  expect(authorizationResponse.state).toBe(challenge.state);
  const vpToken = JSON.parse(authorizationResponse.vp_token);
  expect(Object.keys(vpToken)).toEqual(['link_identity']);
  const presentation = vpToken.link_identity[0] as string;
  expect(presentation.split('~').slice(1, -1)).toEqual([disclosures[0]]);
  const kb = presentation.split('~').at(-1) as string;
  expect(decode(kb.split('.')[1])).toMatchObject({
    aud: challenge.client_id,
    nonce: challenge.nonce,
  });
});

it('submits the OpenID4VP authorization response as direct_post form data', async () => {
  const challenge = openId4VpChallenge();
  const fetchImpl = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== 'POST') return jsonResponse(challenge);
      const body = new URLSearchParams(init.body as string);
      expect(init.headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      });
      expect(body.get('state')).toBe(challenge.state);
      expect(JSON.parse(body.get('vp_token') as string)).toEqual({
        link_identity: [expect.any(String)],
      });
      return jsonResponse({
        ok: true,
        disclosed_claim_names: ['email'],
      });
    },
  );

  const result = await presentOpenId4VpChallenge(
    {
      challengeUrl: 'https://verifier.example/openid4vp/challenge',
      submit: true,
    },
    fetchImpl,
  );
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(result).toEqual({
    protocol: 'openid4vp',
    submitted: true,
    response_uri: challenge.response_uri,
    status: 200,
    response: { ok: true, disclosed_claim_names: ['email'] },
  });
  expect(JSON.stringify(result)).not.toContain('private@example.test');
});

it('rejects OpenID4VP features outside the initial adapter profile', async () => {
  const challenge = openId4VpChallenge({
    dcql_query: {
      credentials: [
        {
          id: 'link_identity',
          format: 'dc+sd-jwt',
          meta: {
            vct_values: ['https://api.link.com/credentials/aap/v1'],
          },
          claims: [{ path: ['address', 'locality'] }],
        },
      ],
    },
  });
  await expect(
    presentOpenId4VpChallenge(
      { challengeUrl: 'https://verifier.example/openid4vp/challenge' },
      async () => jsonResponse(challenge),
    ),
  ).rejects.toThrow('top-level DCQL');
});

it('answers an x401 proof request with an inline Result Artifact', async () => {
  const fetchImpl = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.headers || !('PROOF-RESPONSE' in init.headers)) {
        return x401ChallengeResponse();
      }
      const proofResponse = (init.headers as Record<string, string>)[
        'PROOF-RESPONSE'
      ];
      const artifact = decode(proofResponse);
      expect(artifact.request_id).toBe('link-email-proof-v1');
      expect(artifact.credential_result.protocol).toBe('openid4vp-v1-unsigned');
      const presentation =
        artifact.credential_result.data.vp_token.link_identity[0];
      expect(presentation.split('~').slice(1, -1)).toEqual([disclosures[0]]);
      const kb = presentation.split('~').at(-1) as string;
      expect(decode(kb.split('.')[1])).toMatchObject({
        aud: 'origin:https://verifier.example/',
        nonce: 'x401-nonce',
      });
      return jsonResponse({
        ok: true,
        proof: { disclosed_claim_names: ['email'] },
      });
    },
  );

  const result = await presentX401Resource(
    { resourceUrl: 'https://verifier.example/protected', submit: true },
    fetchImpl,
  );
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(result).toEqual({
    protocol: 'x401',
    version: '0.2.0',
    submitted: true,
    resource_url: 'https://verifier.example/protected',
    status: 200,
    response: {
      ok: true,
      proof: { disclosed_claim_names: ['email'] },
    },
  });
  expect(JSON.stringify(result)).not.toContain('private@example.test');
});

it.each([
  { aud: '', nonce: options.nonce, claim: ['email'] },
  { aud: options.aud, nonce: '', claim: ['email'] },
  { ...options, claim: [] },
  { ...options, claim: [''] },
])('requires an audience, nonce, and explicit claims: %j', async (input) => {
  await expect(presentIdentityCredential(input)).rejects.toThrow();
});

it('rejects unavailable claims instead of disclosing everything', async () => {
  await expect(
    presentIdentityCredential({ ...options, claim: ['address'] }),
  ).rejects.toThrow('not available');
});

it.each([
  ['expired', { exp: now }, 'expired'],
  ['not yet valid', { nbf: now + 60 }, 'not yet valid'],
  [
    'audience restricted',
    { aud: 'https://other.example' },
    'different audience',
  ],
  [
    'unsupported digest',
    { _sd_alg: 'sha-512' },
    'supported Link SD-JWT profile',
  ],
  [
    'plaintext identity claim',
    { email: 'private-plaintext@example.test' },
    'supported Link SD-JWT profile',
  ],
  ['missing expiry', { exp: undefined }, 'supported Link SD-JWT profile'],
])('rejects %s credentials', async (_name, changes, message) => {
  Object.assign(payload, changes);
  await save();
  await expect(presentIdentityCredential(options)).rejects.toThrow(
    message as string,
  );
});

it('accepts an audience restriction containing the requested audience', async () => {
  payload.aud = ['https://other.example', options.aud];
  await save();
  await expect(presentIdentityCredential(options)).resolves.toHaveProperty(
    'presentation',
  );
});

it.each([
  'uncommitted',
  'duplicate claim',
  'duplicate digest',
  'reserved',
  'nested',
  'array element',
  'bad json',
])('rejects %s disclosures', async (kind) => {
  if (kind === 'uncommitted') payload._sd = [];
  else if (kind === 'duplicate claim') {
    disclosures.push(encode(['other-salt', 'email', 'other@example.test']));
    payload._sd = disclosures.map(hash);
  } else if (kind === 'duplicate digest')
    payload._sd = [hash(disclosures[0]), hash(disclosures[0])];
  else {
    const value =
      kind === 'reserved'
        ? ['salt', 'exp', now + 3600]
        : kind === 'nested'
          ? ['salt', 'email', { _sd: ['nested-digest'] }]
          : ['salt', 'array-value'];
    disclosures = [
      kind === 'bad json'
        ? Buffer.from('private-invalid-json').toString('base64url')
        : encode(value),
    ];
    payload._sd = disclosures.map(hash);
  }
  await save();
  await expect(presentIdentityCredential(options)).rejects.toThrow();
});

it('does not generate a replacement for a missing holder key', async () => {
  await fs.unlink(keyFile);
  await expect(presentIdentityCredential(options)).rejects.toThrow(
    'Unable to load',
  );
  await expect(fs.stat(keyFile)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('rejects a holder key that does not match the issuer JWT even if cached metadata matches', async () => {
  await fs.unlink(keyFile);
  const different = loadOrCreateHolderKey(keyFile);
  artifact.holder.jwk = different.publicJwk;
  await save();
  await expect(presentIdentityCredential(options)).rejects.toThrow(
    'does not match',
  );
});

it.each(['artifact', 'key'])('rejects a symbolic-link %s', async (kind) => {
  const target = kind === 'artifact' ? file : keyFile;
  await fs.rename(target, `${target}.real`);
  await fs.symlink(`${target}.real`, target);
  await expect(presentIdentityCredential(options)).rejects.toThrow();
});

it('reports a missing credential without creating one', async () => {
  await fs.unlink(file);
  await expect(presentIdentityCredential(options)).rejects.toThrow(
    'request first',
  );
  await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
});

describe('command output', () => {
  async function run(args: string[]) {
    const resource = vi.fn(() => {
      throw new Error('Unexpected API access');
    });
    const cli = createIdentityCredentialsCli(resource);
    let output = '';
    let code = 0;
    await cli.serve(args, {
      stdout: (text) => {
        output += text;
      },
      exit: (status) => {
        code = status;
      },
    });
    expect(resource).not.toHaveBeenCalled();
    return { output, code };
  }

  it('accepts repeatable --claim flags and returns only the presentation', async () => {
    const { output, code } = await run([
      'present',
      '--aud',
      options.aud,
      '--nonce',
      options.nonce,
      '--claim',
      'email',
      '--claim',
      'phone_number',
      '--format',
      'json',
    ]);
    expect(code).toBe(0);
    const result = JSON.parse(output);
    expect(Object.keys(result)).toEqual(['presentation']);
    expect(result.presentation.split('~').slice(1, -1)).toEqual([
      disclosures[0],
      disclosures[2],
    ]);
    expect(output).not.toContain('private_jwk');
    expect(output).not.toContain(disclosures[1]);
  });

  it('preserves the full-output envelope', async () => {
    const { output, code } = await run([
      'present',
      '--aud',
      options.aud,
      '--nonce',
      options.nonce,
      '--claim',
      'email',
      '--format',
      'json',
      '--full-output',
    ]);
    expect(code).toBe(0);
    expect(JSON.parse(output)).toMatchObject({
      ok: true,
      data: { presentation: expect.any(String) },
    });
  });

  it('accepts --openid4vp-challenge and derives the presentation inputs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(openId4VpChallenge())),
    );
    const { output, code } = await run([
      'present',
      '--openid4vp-challenge',
      'https://verifier.example/openid4vp/challenge',
      '--format',
      'json',
    ]);
    expect(code).toBe(0);
    const result = JSON.parse(output);
    expect(result).toMatchObject({
      protocol: 'openid4vp',
      content_type: 'application/x-www-form-urlencoded',
      authorization_response: {
        state: 'openid4vp-state',
        vp_token: expect.any(String),
      },
    });
  });

  it('accepts --x401-resource and prepares a PROOF-RESPONSE', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => x401ChallengeResponse()),
    );
    const { output, code } = await run([
      'present',
      '--x401-resource',
      'https://verifier.example/protected',
      '--format',
      'json',
    ]);
    expect(code).toBe(0);
    const result = JSON.parse(output);
    expect(result).toMatchObject({
      protocol: 'x401',
      version: '0.2.0',
      resource_url: 'https://verifier.example/protected',
      request_id: 'link-email-proof-v1',
      proof_response: expect.any(String),
    });
  });

  it.each(['--aud', '--nonce', '--claim'])(
    'fails when %s is missing',
    async (missing) => {
      const args = [
        'present',
        ...[
          '--aud',
          options.aud,
          '--nonce',
          options.nonce,
          '--claim',
          'email',
        ].filter((_value, i, array) => array[i - (i % 2)] !== missing),
        '--format',
        'json',
      ];
      const { code } = await run(args);
      expect(code).toBe(1);
    },
  );

  it.each(['artifact', 'key'])(
    'does not print secrets from a malformed %s',
    async (kind) => {
      await fs.writeFile(
        kind === 'artifact' ? file : keyFile,
        'not JSON: private-value-must-stay-on-disk',
      );
      const { output, code } = await run([
        'present',
        '--aud',
        options.aud,
        '--nonce',
        options.nonce,
        '--claim',
        'email',
        '--format',
        'json',
      ]);
      expect(code).toBe(1);
      expect(output).not.toContain('private-value-must-stay-on-disk');
      expect(output).not.toContain('presentation');
    },
  );
});
