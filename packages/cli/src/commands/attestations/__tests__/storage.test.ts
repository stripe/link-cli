import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { type AttestationExport, authorizationHeader } from '../export';
import {
  addAttestationsToPool,
  exportAttestationArtifact,
  getPoolPath,
  readAttestationPool,
  takeAttestation,
} from '../storage';

let directory: string;
function batch(
  tokens = ['token-one', 'token-two'],
  key = 'key-id',
): AttestationExport {
  return {
    version: 1,
    issuer: 'https://api.link.com',
    token_key_id: key,
    count: tokens.length,
    tokens: tokens.map((token) => ({
      token,
      authorization: authorizationHeader(token),
    })),
  };
}

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'link-pool-'));
  vi.spyOn(os, 'homedir').mockReturnValue(directory);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(directory, { recursive: true, force: true });
});

it('appends batches to one private file and drains them with their original issuer keys', async () => {
  const file = await addAttestationsToPool(batch());
  expect(await addAttestationsToPool(batch(['third'], 'rotated-key'))).toBe(
    file,
  );
  expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  expect((await fs.stat(path.dirname(file))).mode & 0o777).toBe(0o700);
  expect(await fs.readdir(path.dirname(file))).toEqual(['pool.json']);
  expect(await takeAttestation()).toEqual({
    issuer: 'https://api.link.com',
    token_key_id: 'key-id',
    token: 'token-one',
    authorization: authorizationHeader('token-one'),
  });
  expect((await readAttestationPool()).batches[0]?.count).toBe(1);
  expect((await takeAttestation()).token).toBe('token-two');
  expect((await takeAttestation()).token_key_id).toBe('rotated-key');
  expect((await readAttestationPool()).batches).toEqual([]);
  await expect(takeAttestation()).rejects.toMatchObject({
    code: 'ATTESTATION_POOL_EMPTY',
  });
});

it('does not import old exports into a missing pool', async () => {
  const file = getPoolPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const exported = path.join(path.dirname(file), 'legacy.json');
  await fs.writeFile(exported, JSON.stringify(batch()));
  await expect(takeAttestation()).rejects.toMatchObject({
    code: 'ATTESTATION_POOL_EMPTY',
  });
  expect(JSON.parse(await fs.readFile(exported, 'utf8'))).toEqual(batch());
  await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('exports to an explicit file without changing the managed pool', async () => {
  await addAttestationsToPool(batch());
  const before = await fs.readFile(getPoolPath());
  const file = path.join(directory, 'export.json');
  await exportAttestationArtifact(batch(['exported']), file);
  expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(
    batch(['exported']),
  );
  expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  expect(await fs.readFile(getPoolPath())).toEqual(before);
  await expect(exportAttestationArtifact(batch(), file)).rejects.toThrow(
    'OUTPUT_FILE_EXISTS',
  );
});

it('reserves the pool, lock, and storage directory from exports, even before pool creation', async () => {
  for (const file of [
    getPoolPath(),
    `${getPoolPath()}.lock`,
    path.dirname(getPoolPath()),
  ]) {
    await expect(exportAttestationArtifact(batch(), file)).rejects.toThrow(
      'outside the CLI attestation storage',
    );
  }
  expect(await fs.readdir(directory)).toEqual([]);
});

it('rejects exports through aliases of the pool and lock paths', async () => {
  await fs.mkdir(path.dirname(getPoolPath()), { recursive: true });
  const alias = path.join(directory, 'alias');
  await fs.symlink(path.dirname(getPoolPath()), alias);
  for (const name of ['pool.json', 'pool.json.lock']) {
    await expect(
      exportAttestationArtifact(batch(), path.join(alias, name)),
    ).rejects.toThrow('outside the CLI attestation storage');
  }
  expect(await fs.readdir(path.dirname(getPoolPath()))).toEqual([]);
});

it('fails closed for corrupt pools without replacing them or revealing token contents', async () => {
  await addAttestationsToPool(batch());
  await fs.writeFile(getPoolPath(), 'secret-token-invalid-json');
  await expect(takeAttestation()).rejects.toThrow(
    `Invalid JSON in ${getPoolPath()}.`,
  );
  await expect(addAttestationsToPool(batch(['another']))).rejects.toThrow(
    'Invalid JSON',
  );
  expect(await fs.readFile(getPoolPath(), 'utf8')).toBe(
    'secret-token-invalid-json',
  );
});

it('rejects duplicate and malformed tokens without committing a mutation', async () => {
  await addAttestationsToPool(batch());
  const before = await fs.readFile(getPoolPath());
  await expect(addAttestationsToPool(batch())).rejects.toThrow(
    'duplicate tokens',
  );
  expect(await fs.readFile(getPoolPath())).toEqual(before);
  await fs.writeFile(
    getPoolPath(),
    JSON.stringify({ version: 2, batches: [batch(['invalid\ntoken'])] }),
  );
  const invalid = await fs.readFile(getPoolPath());
  await expect(takeAttestation()).rejects.toThrow(
    'Invalid attestation token encoding',
  );
  expect(await fs.readFile(getPoolPath())).toEqual(invalid);
});

it('leaves the original pool intact when atomic replacement fails', async () => {
  await addAttestationsToPool(batch());
  const before = await fs.readFile(getPoolPath());
  vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('disk unavailable'));
  await expect(takeAttestation()).rejects.toThrow('disk unavailable');
  expect(await fs.readFile(getPoolPath())).toEqual(before);
  expect(await fs.readdir(path.dirname(getPoolPath()))).toEqual(['pool.json']);
  expect((await takeAttestation()).token).toBe('token-one');
});

it('rejects symbolic-link pool files and directories without writing to their targets', async () => {
  const target = path.join(directory, 'target.json');
  await fs.writeFile(target, 'untouched');
  await fs.mkdir(path.dirname(getPoolPath()), { recursive: true });
  await fs.symlink(target, getPoolPath());
  await expect(addAttestationsToPool(batch())).rejects.toThrow('symbolic link');
  await expect(takeAttestation()).rejects.toThrow('symbolic link');
  expect(await fs.readFile(target, 'utf8')).toBe('untouched');
  await fs.rm(path.dirname(getPoolPath()), { recursive: true });
  await fs.mkdir(path.join(directory, 'target'));
  await fs.symlink(path.join(directory, 'target'), path.dirname(getPoolPath()));
  await expect(addAttestationsToPool(batch())).rejects.toThrow(
    'DIRECTORY_INVALID',
  );
  expect(await fs.readdir(path.join(directory, 'target'))).toEqual([]);
});

it('does not steal an old lock from a paused writer', async () => {
  await addAttestationsToPool(batch());
  const before = await fs.readFile(getPoolPath());
  const lock = `${getPoolPath()}.lock`;
  await fs.mkdir(lock);
  await fs.utimes(lock, new Date(0), new Date(0));
  await expect(takeAttestation()).rejects.toMatchObject({
    code: 'ATTESTATION_POOL_LOCKED',
  });
  expect(await fs.readFile(getPoolPath())).toEqual(before);
  expect((await fs.stat(lock)).isDirectory()).toBe(true);
}, 10_000);

it('serializes separate CLI processes so a token is handed out at most once', async () => {
  const tokens = Array.from({ length: 6 }, (_, i) => `token-${i}`);
  await addAttestationsToPool(batch(tokens));
  const preload = `
    import os from 'node:os';
    import {syncBuiltinESMExports} from 'node:module';
    os.homedir = () => ${JSON.stringify(directory)};
    syncBuiltinESMExports();
    const nativeFetch = globalThis.fetch;
    globalThis.fetch = (url, options) => {
      if (String(url).startsWith('data:')) return nativeFetch(url, options);
      throw new Error('Unexpected API request');
    };
  `;
  const args = [
    '--import',
    `data:text/javascript,${encodeURIComponent(preload)}`,
    fileURLToPath(new URL('../../../../dist/cli.js', import.meta.url)),
    'identity',
    'attestations',
    'take',
    '--format',
    'json',
  ];
  const env = {
    ...process.env,
    LINK_IDENTITY_COMMANDS: '1',
    LINK_AUTH_FILE: path.join(directory, 'auth.json'),
    LINK_ACCESS_TOKEN: undefined,
    LINK_REFRESH_TOKEN: undefined,
    NODE_OPTIONS: undefined,
    NO_UPDATE_NOTIFIER: '1',
  };
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () =>
      promisify(execFile)(process.execPath, args, { env, timeout: 15_000 }),
    ),
  );
  const successful = results.filter((result) => result.status === 'fulfilled');
  expect(
    successful.map((result) => JSON.parse(result.value.stdout).token).sort(),
  ).toEqual(tokens);
  const failed = results.filter((result) => result.status === 'rejected');
  expect(failed).toHaveLength(2);
  for (const result of failed) {
    expect(JSON.parse(result.reason.stdout).code).toBe(
      'ATTESTATION_POOL_EMPTY',
    );
  }
  expect((await readAttestationPool()).batches).toEqual([]);
}, 30_000);

it('serializes concurrent appends and takes without losing new batches', async () => {
  await addAttestationsToPool(batch(['initial']));
  const updates = Array.from({ length: 6 }, (_, i) =>
    addAttestationsToPool(batch([`new-${i}`])),
  );
  await Promise.all([...updates, takeAttestation()]);
  const remaining = (await readAttestationPool()).batches.flatMap((item) =>
    item.tokens.map(({ token }) => token),
  );
  expect(remaining.sort()).toEqual(
    Array.from({ length: 6 }, (_, i) => `new-${i}`),
  );
});
