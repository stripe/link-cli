import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, expect, it } from 'vitest';

const execute = promisify(execFile);
const cliPath = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
let directory: string;
let preload: string;
let artifactPath: string;

beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'link-inspection-cli-'));
  preload = path.join(directory, 'preload.mjs');
  await fs.writeFile(
    preload,
    `
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
os.homedir = () => ${JSON.stringify(directory)};
syncBuiltinESMExports();
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  // Ink loads its bundled Yoga WASM through a data URL, without network access.
  if (String(input).startsWith('data:')) return originalFetch(input, init);
  throw new Error('Inspection must not fetch');
};
`,
  );
  const credentialDirectory = path.join(directory, '.link-cli', 'credentials');
  const attestationDirectory = path.join(
    directory,
    '.link-cli',
    'attestations',
  );
  await fs.mkdir(credentialDirectory, { recursive: true });
  await fs.mkdir(attestationDirectory, { recursive: true });
  await fs.writeFile(
    path.join(credentialDirectory, 'current.json'),
    JSON.stringify({
      version: 1,
      credential: 'secret-credential',
      issuer: 'https://api.link.com',
      expires_at: '2000-01-01T00:00:00Z',
      holder: {
        path: path.join(directory, 'missing-private-key.jwk'),
        thumbprint: 'thumbprint',
      },
      claims: { email: 'secret@example.test' },
    }),
  );
  artifactPath = path.join(attestationDirectory, 'batch.json');
  await fs.writeFile(
    artifactPath,
    JSON.stringify({
      version: 1,
      issuer: 'https://api.link.com',
      token_key_id: 'issuer-key',
      count: 1,
      tokens: [
        { token: 'secret-token', authorization: 'PrivateToken secret-token' },
      ],
    }),
  );
});
afterAll(() => fs.rm(directory, { recursive: true, force: true }));

function run(args: string[], gate = '1') {
  return execute(process.execPath, ['--import', preload, cliPath, ...args], {
    env: {
      ...process.env,
      NODE_OPTIONS: undefined,
      LINK_IDENTITY_COMMANDS: gate,
      LINK_AUTH_FILE: path.join(directory, 'auth.json'),
      LINK_ACCESS_TOKEN: undefined,
      LINK_REFRESH_TOKEN: undefined,
      LINK_NO_REFRESH: '1',
      NO_UPDATE_NOTIFIER: '1',
    },
  });
}

it.each([
  ['credentials', 'list'],
  ['credentials', 'show'],
  ['attestations', 'list'],
  ['attestations', 'show', '--file', 'batch.json'],
])('prints local metadata without authentication: %s %s', async (...args) => {
  const { stdout, stderr } = await run([
    'identity',
    ...args,
    '--format',
    'json',
  ]);
  const result = JSON.parse(stdout);
  expect(stderr).toBe('');
  expect(stdout).not.toContain('secret');
  if (args[0] === 'credentials') {
    const metadata = args[1] === 'list' ? result.credentials[0] : result;
    expect(metadata.expired).toBe(true);
    expect(metadata.claim_names).toEqual(['email']);
  } else {
    expect(result.stored_token_count).toBe(1);
    const metadata = args[1] === 'list' ? result.attestations[0] : result;
    expect(metadata.output_file).toBe(artifactPath);
    expect(metadata.usage).toBe('untracked');
  }
  await expect(
    fs.stat(path.join(directory, 'missing-private-key.jwk')),
  ).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each(['toon', 'yaml', 'md', 'jsonl'])(
  'supports --format %s',
  async (format) => {
    const { stdout, stderr } = await run([
      'identity',
      'attestations',
      'show',
      '--file',
      artifactPath,
      '--format',
      format,
    ]);
    expect(stderr).toBe('');
    expect(stdout).toContain('stored_token_count');
    expect(stdout).not.toContain('secret');
  },
);

it('returns actionable CLI errors for missing files and required flags', async () => {
  await expect(
    run([
      'identity',
      'attestations',
      'show',
      '--file',
      'missing.json',
      '--format',
      'json',
    ]),
  ).rejects.toMatchObject({
    code: 1,
    stdout: expect.stringContaining('ARTIFACT_NOT_FOUND'),
  });
  await expect(
    run(['identity', 'attestations', 'show', '--format', 'json']),
  ).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining('file') });
});

it('keeps inspection behind the identity feature gate', async () => {
  await expect(
    run(['identity', 'credentials', 'list', '--format', 'json'], ''),
  ).rejects.toMatchObject({
    code: 1,
    stdout: expect.stringContaining('COMMAND_NOT_FOUND'),
  });
  const { stdout } = await run(['identity', 'attestations', 'show', '--help']);
  expect(stdout).toContain('--file');
  expect(stdout).toContain('metadata');
});
