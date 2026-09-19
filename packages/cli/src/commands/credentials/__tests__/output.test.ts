import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ReactElement } from 'react';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
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

beforeEach(() => {
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

function credentialCli() {
  return createIdentityCredentialsCli(() => ({
    issue: async ({ cnf }) => ({
      credential: `header.${Buffer.from(JSON.stringify({ cnf })).toString(
        'base64url',
      )}.sig~`,
      issuer: 'https://api.link.com',
      expires_at: '2026-09-18T00:00:00Z',
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

it('returns the credential with an explicit format or non-TTY output', async () => {
  expect(await run(credentialCli(), ['request', '--format', 'json'])).toContain(
    '"credential"',
  );

  Object.defineProperty(process.stdout, 'isTTY', {
    configurable: true,
    value: false,
  });
  expect(await run(credentialCli(), ['request'])).toContain('.sig~');
});

it('preserves the credential in a requested full-output envelope', async () => {
  const output = JSON.parse(
    await run(credentialCli(), [
      'request',
      '--full-output',
      '--format',
      'json',
    ]),
  );

  expect(output.ok).toBe(true);
  expect(output.data.credential).toContain('.sig~');
  expect(output.data.holder.path).toBe(
    path.join(state.directory, 'holder-key.jwk'),
  );
  expect(await run(credentialCli(), ['request', '--full-output'])).toContain(
    'credential:',
  );
});

it('prints the attestation pool path without exposing raw tokens', async () => {
  const home = path.join(state.directory, 'attestation-home');
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  const cli = createAttestationsCli(() => ({
    request: async () => ({
      tokens: ['dGVzdA'],
      issuer: 'https://api.link.com',
      token_key_id: 'test-key',
      count: 1,
    }),
  }));

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
