import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createAttestationsCli } from '../../attestations';
import { listAttestations, showAttestation } from '../../attestations/inspect';
import { createIdentityCredentialsCli } from '../../credentials';
import {
  listIdentityCredentials,
  showIdentityCredential,
} from '../../credentials/inspect';

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

it('lists empty stores without creating files and reports a missing current credential', async () => {
  expect(await listIdentityCredentials()).toEqual({
    credentials: [],
    errors: [],
  });
  expect(await listAttestations()).toMatchObject({
    attestations: [],
    stored_token_count: 0,
    errors: [],
  });
  await expect(showIdentityCredential()).rejects.toMatchObject({
    code: 'ARTIFACT_NOT_FOUND',
  });
  expect(await fs.readdir(directory)).toEqual([]);
});

it('shows expired metadata without reading the holder key, printing secrets, or changing the cache', async () => {
  const file = await save('credentials', 'current.json', credential);
  const before = await fs.readFile(file);
  const stat = await fs.stat(file);
  const result = await showIdentityCredential();
  expect(result).toEqual({
    output_file: file,
    issuer: credential.issuer,
    expires_at: credential.expires_at,
    expired: true,
    holder: credential.holder,
    claim_names: ['email', 'given_name'],
  });
  expect(await listIdentityCredentials()).toEqual({
    credentials: [result],
    errors: [],
  });
  expect(JSON.stringify(result)).not.toContain('secret');
  expect(await fs.readFile(file)).toEqual(before);
  expect((await fs.stat(file)).mtimeMs).toBe(stat.mtimeMs);
  expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  await save('credentials', 'current.json', {
    ...credential,
    expires_at: '2026-09-19T00:00:00Z',
  });
  expect(await showIdentityCredential()).toMatchObject({ expired: false });
});

it('lists all saved batches in filename order and shows either a filename or returned absolute path', async () => {
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
  expect(result.stored_token_count).toBe(3);
  expect(result.errors).toEqual([]);
  expect(result.note).toContain('not tracked');
  expect(await showAttestation(second)).toEqual(
    await showAttestation('b.json'),
  );
  const shown = await showAttestation('b.json');
  expect(shown).toMatchObject({
    output_file: second,
    stored_token_count: 2,
    usage: 'untracked',
  });
  expect(shown).not.toHaveProperty('expires_at');
  expect(JSON.stringify(shown)).not.toContain('secret');
  expect(JSON.stringify(result)).not.toContain('secret');
  expect(JSON.parse(await fs.readFile(second, 'utf8'))).toEqual(attestation);
});

it('reports a corrupt batch without hiding valid batches or quoting token contents', async () => {
  await save('attestations', 'valid.json', attestation);
  const broken = await save('attestations', 'broken.json', {});
  await fs.writeFile(broken, 'secret-token-invalid-json');
  const result = await listAttestations();
  expect(result.attestations).toHaveLength(1);
  expect(result.stored_token_count).toBe(2);
  expect(result.errors).toEqual([
    {
      output_file: broken,
      code: 'ARTIFACT_INVALID',
      message: `Invalid JSON in ${broken}.`,
    },
  ]);
  await expect(showAttestation(broken)).rejects.toMatchObject({
    code: 'ARTIFACT_INVALID',
  });
  expect(JSON.stringify(result)).not.toContain('secret-token');
});

it.each([
  { ...attestation, version: 2 },
  { ...attestation, count: 3 },
  { ...attestation, tokens: ['secret-token'] },
])('rejects invalid or unsupported attestation artifacts', async (artifact) => {
  const file = await save('attestations', 'invalid.json', artifact);
  await expect(showAttestation(file)).rejects.toMatchObject({
    code: 'ARTIFACT_INVALID',
  });
});

it('reports invalid credential metadata without replacing it or exposing claim values', async () => {
  const file = await save('credentials', 'current.json', {
    ...credential,
    expires_at: 'yesterday',
  });
  expect(await listIdentityCredentials()).toMatchObject({
    credentials: [],
    errors: [{ output_file: file, code: 'ARTIFACT_INVALID' }],
  });
  await expect(showIdentityCredential()).rejects.toMatchObject({
    code: 'ARTIFACT_INVALID',
  });
  expect(JSON.parse(await fs.readFile(file, 'utf8')).expires_at).toBe(
    'yesterday',
  );
});

it('rejects symlink files, directories, and paths outside the attestation store', async () => {
  const file = await save('attestations', 'valid.json', attestation);
  await fs.symlink(file, path.join(path.dirname(file), 'symlink.json'));
  await fs.mkdir(path.join(path.dirname(file), 'directory.json'));
  expect((await listAttestations()).errors).toHaveLength(2);
  await expect(showAttestation('symlink.json')).rejects.toMatchObject({
    code: 'ARTIFACT_READ_FAILED',
  });
  await expect(
    showAttestation('../credentials/current.json'),
  ).rejects.toMatchObject({ code: 'ARTIFACT_PATH_INVALID' });
  await expect(showAttestation('/tmp/unrelated.json')).rejects.toMatchObject({
    code: 'ARTIFACT_PATH_INVALID',
  });
  await fs.rename(path.dirname(file), path.join(directory, 'moved'));
  await fs.symlink(path.join(directory, 'moved'), path.dirname(file));
  await expect(listAttestations()).rejects.toMatchObject({
    code: 'ARTIFACT_DIRECTORY_INVALID',
  });
});

it('sanitizes control sequences in displayed local metadata', async () => {
  await save('credentials', 'current.json', {
    ...credential,
    holder: { ...credential.holder, thumbprint: '\u001b[31mred\u001b[0m' },
  });
  expect((await showIdentityCredential()).holder.thumbprint).toBe('red');
});

it('runs list/show without creating an API resource and preserves full-output envelopes', async () => {
  const createResource = vi.fn(() => {
    throw new Error('Inspection must not access Link');
  });
  const credentialCli = createIdentityCredentialsCli(createResource);
  const attestationCli = createAttestationsCli(createResource);
  await save('credentials', 'current.json', credential);
  await save('attestations', 'batch.json', attestation);
  for (const [cli, args] of [
    [credentialCli, ['list']],
    [credentialCli, ['show']],
    [attestationCli, ['list']],
    [attestationCli, ['show', '--file', 'batch.json']],
  ] as const) {
    let output = '';
    await cli.serve([...args, '--format', 'json', '--full-output'], {
      stdout: (text) => {
        output += text;
      },
      exit: (code) => {
        expect(code).toBe(0);
      },
    });
    expect(JSON.parse(output).ok).toBe(true);
    expect(output).not.toContain('secret');
  }
  expect(createResource).not.toHaveBeenCalled();
});
