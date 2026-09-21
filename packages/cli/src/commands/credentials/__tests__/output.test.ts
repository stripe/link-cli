import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ReactElement } from 'react';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createAttestationsCli } from '../../attestations';
import {
  SavedArtifact,
  type SavedArtifactDetail,
} from '../../identity/saved-artifact';
import { createIdentityCredentialsCli } from '../index';

const state = vi.hoisted(() => ({
  directory: '',
  interactiveElements: [] as unknown[],
}));
vi.mock('../../../utils/render-interactive', () => ({
  renderInteractive: async (
    element: unknown,
    getResult?: () => unknown | Promise<unknown>,
  ) => {
    state.interactiveElements.push(element);
    return getResult?.();
  },
}));
vi.mock('../holder-key', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../holder-key')>();
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  state.directory = mkdtempSync(join(tmpdir(), 'link-credential-output-'));
  return {
    ...actual,
    DEFAULT_HOLDER_KEY_PATH: join(state.directory, 'holder-key.jwk'),
  };
});

const originalTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

beforeEach(async () => {
  await fs.rm(path.join(state.directory, '.link-cli'), {
    recursive: true,
    force: true,
  });
  state.interactiveElements.length = 0;
  Object.defineProperty(process.stdout, 'isTTY', {
    configurable: true,
    value: true,
  });
  vi.spyOn(os, 'homedir').mockReturnValue(state.directory);
});

afterEach(() => {
  if (originalTTY) {
    Object.defineProperty(process.stdout, 'isTTY', originalTTY);
  } else {
    Reflect.deleteProperty(process.stdout, 'isTTY');
  }
  vi.restoreAllMocks();
});

afterAll(() => fs.rm(state.directory, { recursive: true, force: true }));

const secretEmail = 'private-identity@example.test';
const disclosure = Buffer.from(
  JSON.stringify(['salt', 'email', secretEmail]),
).toString('base64url');
const secretToken = 'c2VjcmV0LWF0dGVzdGF0aW9u';

function credentialCli() {
  return createIdentityCredentialsCli(() => ({
    issue: async ({ cnf }) => ({
      credential: `header.${Buffer.from(JSON.stringify({ cnf })).toString(
        'base64url',
      )}.sig~${disclosure}~`,
      issuer: 'https://api.link.com',
      expires_at: '2026-09-18T00:00:00Z',
    }),
  }));
}

function attestationCli() {
  return createAttestationsCli(() => ({
    request: async () => ({
      tokens: [secretToken],
      issuer: 'https://api.link.com',
      token_key_id: 'test-key',
      count: 1,
    }),
  }));
}

async function run(
  cli: { serve: ReturnType<typeof credentialCli>['serve'] },
  args: string[],
) {
  let output = '';
  let exitCode: number | undefined;
  const originalArgv = process.argv;
  process.argv = ['node', 'link-cli', ...args];
  try {
    await cli.serve(args, {
      stdout: (text) => {
        output += text;
      },
      exit: (code) => {
        exitCode = code;
      },
    });
  } finally {
    process.argv = originalArgv;
  }
  expect(exitCode ?? 0, output).toBe(0);
  return output;
}

it('prints a non-secret TTY confirmation and saves the credential', async () => {
  const output = await run(credentialCli(), ['request']);

  expect(output).toBe('');
  expect(state.interactiveElements).toHaveLength(1);
  const view = state.interactiveElements[0] as ReactElement<{
    message: string;
    outputFile: string;
    details: SavedArtifactDetail[];
  }>;
  expect(view.type).toBe(SavedArtifact);
  expect(view.props.message).toBe('Identity credential saved');
  expect(view.props.outputFile).toContain('.link-cli/credentials/current.json');
  expect(view.props.details).toEqual([
    { label: 'Expires', value: '2026-09-18T00:00:00Z' },
  ]);

  const directory = path.join(state.directory, '.link-cli', 'credentials');
  const files = await fs.readdir(directory);
  expect(files).toHaveLength(1);
  const file = path.join(directory, files[0]);
  expect(JSON.parse(await fs.readFile(file, 'utf8')).credential).toContain(
    '.sig~',
  );
  expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  expect((await fs.stat(directory)).mode & 0o777).toBe(0o700);
  expect(
    Object.keys(
      JSON.parse(
        await fs.readFile(path.join(state.directory, 'holder-key.jwk'), 'utf8'),
      ),
    ),
  ).toEqual(['private_jwk']);
});

describe.each([true, false])('request metadata with isTTY=%s', (isTTY) => {
  it.each(
    [
      [],
      ['--json'],
      ['--format', 'json'],
      ['--format', 'toon'],
      ['--format', 'yaml'],
      ['--format', 'md'],
      ['--full-output'],
      ['--full-output', '--format', 'json'],
    ].map((flags) => ({ flags })),
  )(
    'keeps both request artifacts out of stdout with flags $flags',
    async ({ flags }) => {
      Object.defineProperty(process.stdout, 'isTTY', {
        configurable: true,
        value: isTTY,
      });

      const credentialOutput = await run(credentialCli(), [
        'request',
        ...flags,
      ]);
      const attestationOutput = await run(attestationCli(), [
        'request',
        '--count',
        '1',
        ...flags,
      ]);
      const credentialFile = path.join(
        state.directory,
        '.link-cli/credentials/current.json',
      );
      const poolFile = path.join(
        state.directory,
        '.link-cli/attestations/pool.json',
      );
      const artifact = JSON.parse(await fs.readFile(credentialFile, 'utf8'));
      const holderKey = JSON.parse(
        await fs.readFile(artifact.holder.path, 'utf8'),
      );

      expect(artifact.credential).toContain(`.sig~${disclosure}~`);
      expect(artifact.claims).toEqual({ email: secretEmail });
      expect(holderKey.private_jwk.d).toEqual(expect.any(String));
      expect(
        JSON.parse(await fs.readFile(poolFile, 'utf8')).batches[0].tokens[0]
          .token,
      ).toBe(secretToken);

      for (const output of [credentialOutput, attestationOutput]) {
        for (const secret of [
          artifact.credential,
          disclosure,
          secretEmail,
          secretToken,
          holderKey.private_jwk.d,
        ]) {
          expect(output).not.toContain(secret);
        }
      }
      if (isTTY && flags.length === 0) {
        expect(credentialOutput).toBe('');
        expect(attestationOutput).toBe('');
        return;
      }
      expect(credentialOutput).toContain(credentialFile);
      expect(attestationOutput).toContain(poolFile);

      if (flags.includes('json') || flags.includes('--json')) {
        const credential = JSON.parse(credentialOutput);
        const attestation = JSON.parse(attestationOutput);
        const fullOutput = flags.includes('--full-output');
        if (fullOutput) {
          expect(credential.ok).toBe(true);
          expect(attestation.ok).toBe(true);
        }
        expect(fullOutput ? credential.data : credential).toEqual({
          issuer: artifact.issuer,
          expires_at: artifact.expires_at,
          holder: {
            path: artifact.holder.path,
            thumbprint: artifact.holder.thumbprint,
          },
          claim_names: ['email'],
          output_file: credentialFile,
        });
        expect(fullOutput ? attestation.data : attestation).toEqual({
          issuer: artifact.issuer,
          token_key_id: 'test-key',
          count: 1,
          output_file: poolFile,
        });
      }
    },
  );
});

it('prints the attestation pool path without exposing raw tokens', async () => {
  const home = path.join(state.directory, 'attestation-home');
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  const cli = attestationCli();

  const output = await run(cli, ['request', '--count', '1']);

  expect(output).toBe('');
  expect(state.interactiveElements).toHaveLength(1);
  const view = state.interactiveElements[0] as ReactElement<{
    message: string;
    outputFile: string;
    details: SavedArtifactDetail[];
  }>;
  expect(view.type).toBe(SavedArtifact);
  expect(view.props.message).toBe('Attestation tokens added to pool');
  expect(view.props.outputFile).toBe(
    path.join(home, '.link-cli', 'attestations', 'pool.json'),
  );
  expect(view.props.details).toEqual([{ label: 'Count', value: 1 }]);
  const directory = path.join(home, '.link-cli', 'attestations');
  const files = await fs.readdir(directory);
  expect(files).toEqual(['pool.json']);
  const pool = JSON.parse(await fs.readFile(view.props.outputFile, 'utf8'));
  expect(pool.version).toBe(2);
  expect(pool.batches).toHaveLength(1);
  expect(pool.batches[0].tokens).toHaveLength(1);
});
