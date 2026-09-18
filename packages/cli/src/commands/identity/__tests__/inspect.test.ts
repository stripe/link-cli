import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { listAttestations } from '../../attestations/inspect';
import { listIdentityCredentials } from '../../credentials/inspect';

let directory: string;
const credential = {
  version: 1,
  credential: 'secret-credential',
  issuer: 'https://api.link.com',
  expires_at: '2026-09-18T00:00:00Z',
  holder: {
    path: '/does-not-exist/holder-key.jwk',
    thumbprint: 'holder-thumbprint',
  },
  claims: { email: 'secret@example.test', given_name: 'Secret' },
};
const attestation = {
  version: 1,
  issuer: 'https://api.link.com',
  token_key_id: 'issuer-key',
  count: 2,
  tokens: [
    { token: 'secret-token-one', authorization: 'PrivateToken secret-one' },
    { token: 'secret-token-two', authorization: 'PrivateToken secret-two' },
  ],
};

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'link-inspect-'));
  vi.spyOn(os, 'homedir').mockReturnValue(directory);
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-18T00:00:00Z'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(directory, { recursive: true, force: true });
});

async function save(kind: string, name: string, value: unknown) {
  const file = path.join(directory, '.link-cli', kind, name);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, JSON.stringify(value), { mode: 0o600 });
  return file;
}

it('lists empty stores without creating files', async () => {
  expect(await listIdentityCredentials()).toEqual({
    credentials: [],
    errors: [],
  });
  expect(await listAttestations()).toMatchObject({
    attestations: [],
    total_token_count: 0,
    errors: [],
  });
  expect(await fs.readdir(directory)).toEqual([]);
});

it('lists expired metadata without reading the holder key, printing secrets, or changing the cache', async () => {
  const file = await save('credentials', 'current.json', credential);
  const before = await fs.readFile(file);
  const stat = await fs.stat(file);
  const result = await listIdentityCredentials();
  expect(result.errors).toEqual([]);
  expect(result.credentials).toEqual([
    {
      output_file: file,
      issuer: credential.issuer,
      expires_at: credential.expires_at,
      expired: true,
      holder: credential.holder,
      claim_names: ['email', 'given_name'],
    },
  ]);
  expect(JSON.stringify(result)).not.toContain('secret');
  expect(await fs.readFile(file)).toEqual(before);
  expect((await fs.stat(file)).mtimeMs).toBe(stat.mtimeMs);
  expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  await save('credentials', 'current.json', {
    ...credential,
    expires_at: '2026-09-19T00:00:00Z',
  });
  expect((await listIdentityCredentials()).credentials[0]).toMatchObject({
    expired: false,
  });
});

it('lists all saved batches in filename order with per-file and total stored counts', async () => {
  const second = await save('attestations', 'b.json', attestation);
  const first = await save('attestations', 'a.json', {
    ...attestation,
    count: 1,
    tokens: attestation.tokens.slice(0, 1),
  });
  await save('attestations', 'ignored.txt', attestation);
  const result = await listAttestations();
  expect(result.attestations.map((item) => item.output_file)).toEqual([
    first,
    second,
  ]);
  expect(result.total_token_count).toBe(3);
  expect(result.errors).toEqual([]);
  expect(result.note).toContain('not tracked');
  expect(result.attestations[1]).toEqual({
    output_file: second,
    issuer: attestation.issuer,
    token_key_id: attestation.token_key_id,
    stored_token_count: 2,
  });
  expect(JSON.stringify(result)).not.toContain('secret');
  expect(JSON.parse(await fs.readFile(second, 'utf8'))).toEqual(attestation);
});

it('reports a corrupt batch without hiding valid batches or quoting token contents', async () => {
  await save('attestations', 'valid.json', attestation);
  const broken = await save('attestations', 'broken.json', {});
  await fs.writeFile(broken, 'secret-token-invalid-json');
  const result = await listAttestations();
  expect(result.attestations).toHaveLength(1);
  expect(result.total_token_count).toBe(2);
  expect(result.errors).toEqual([
    {
      output_file: broken,
      code: 'INVALID_INPUT',
      message: `Invalid JSON in ${broken}.`,
    },
  ]);
  expect(JSON.stringify(result)).not.toContain('secret-token');
});

it.each([
  { ...attestation, version: 2 },
  { ...attestation, count: 3 },
  { ...attestation, tokens: ['secret-token'] },
])('rejects invalid or unsupported attestation artifacts', async (artifact) => {
  const file = await save('attestations', 'invalid.json', artifact);
  expect(await listAttestations()).toMatchObject({
    attestations: [],
    total_token_count: 0,
    errors: [{ output_file: file, code: 'INVALID_INPUT' }],
  });
});

it('reports invalid credential metadata without replacing it or exposing claim values', async () => {
  const file = await save('credentials', 'current.json', {
    ...credential,
    expires_at: 'yesterday',
  });
  expect(await listIdentityCredentials()).toMatchObject({
    credentials: [],
    errors: [{ output_file: file, code: 'INVALID_INPUT' }],
  });
  expect(JSON.parse(await fs.readFile(file, 'utf8')).expires_at).toBe(
    'yesterday',
  );
});

it('rejects symlink files and directories in the attestation store', async () => {
  const file = await save('attestations', 'valid.json', attestation);
  await fs.symlink(file, path.join(path.dirname(file), 'symlink.json'));
  await fs.mkdir(path.join(path.dirname(file), 'directory.json'));
  expect((await listAttestations()).errors).toHaveLength(2);
  await fs.rename(path.dirname(file), path.join(directory, 'moved'));
  await fs.symlink(path.join(directory, 'moved'), path.dirname(file));
  await expect(listAttestations()).rejects.toThrow('symbolic link');
});

it('sanitizes control sequences in displayed local metadata', async () => {
  await save('credentials', 'current.json', {
    ...credential,
    holder: { ...credential.holder, thumbprint: '\u001b[31mred\u001b[0m' },
  });
  expect(
    (await listIdentityCredentials()).credentials[0]?.holder.thumbprint,
  ).toBe('red');
});

it('runs the built commands without auth or network, preserves envelopes, and requires the identity flag', async () => {
  await save('credentials', 'current.json', credential);
  await save('attestations', 'batch.json', attestation);
  const preload = `
    import os from 'node:os';
    import { syncBuiltinESMExports } from 'node:module';
    os.homedir = () => ${JSON.stringify(directory)};
    syncBuiltinESMExports();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      if (String(input).startsWith('data:')) return originalFetch(input, init);
      throw new Error('Unexpected network');
    };
  `;
  const env = {
    ...process.env,
    LINK_IDENTITY_COMMANDS: '1',
    LINK_AUTH_FILE: path.join(directory, 'auth.json'),
    LINK_ACCESS_TOKEN: undefined,
    LINK_REFRESH_TOKEN: undefined,
    NODE_OPTIONS: undefined,
    NO_UPDATE_NOTIFIER: '1',
  };
  const nodeArgs = [
    '--import',
    `data:text/javascript,${encodeURIComponent(preload)}`,
    fileURLToPath(new URL('../../../../dist/cli.js', import.meta.url)),
  ];
  for (const args of [
    ['credentials', 'list'],
    ['attestations', 'list'],
  ]) {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [...nodeArgs, 'identity', ...args, '--format', 'json', '--full-output'],
      { env },
    );
    expect(JSON.parse(stdout).ok).toBe(true);
    expect(stdout).toContain('output_file');
    expect(stdout).not.toContain('secret');
  }
  await expect(
    promisify(execFile)(
      process.execPath,
      [...nodeArgs, 'identity', 'credentials', 'list', '--format', 'json'],
      { env: { ...env, LINK_IDENTITY_COMMANDS: undefined } },
    ),
  ).rejects.toMatchObject({ code: 1 });
  expect(await fs.readdir(directory)).toEqual(['.link-cli']);
}, 30_000);
