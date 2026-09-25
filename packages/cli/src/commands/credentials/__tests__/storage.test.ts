import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IdentityCredentialIssueResult } from '../issue';
import { writeIdentityCredentialArtifact } from '../storage';

const artifact: IdentityCredentialIssueResult = {
  version: 1,
  credential: 'credential',
  issuer: 'https://api.link.com',
  expires_at: '2026-09-18T00:00:00Z',
  holder: {
    jwk: { kty: 'OKP', crv: 'Ed25519', x: 'public-key' },
    thumbprint: 'thumbprint',
    path: '/path/to/holder-key.jwk',
    created: true,
  },
};

describe('identity credential artifact storage', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'link-credentials-'));
    vi.spyOn(os, 'homedir').mockReturnValue(tmpDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('atomically replaces the current artifact in a private directory', async () => {
    const directory = path.join(tmpDir, '.link-cli', 'credentials');
    const first = await writeIdentityCredentialArtifact(artifact);
    const replacement = { ...artifact, credential: 'replacement' };
    const second = await writeIdentityCredentialArtifact(replacement);

    expect(first).toBe(second);
    expect(path.basename(first)).toBe('current.json');
    expect(path.dirname(first)).toBe(directory);
    expect(JSON.parse(await fs.readFile(first, 'utf8'))).toEqual(replacement);
    expect(await fs.readdir(directory)).toEqual(['current.json']);
    expect((await fs.stat(directory)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(first)).mode & 0o777).toBe(0o600);
  });

  it('rejects a symbolic-link output directory', async () => {
    const target = path.join(tmpDir, 'target');
    const directory = path.join(tmpDir, '.link-cli', 'credentials');
    await fs.mkdir(target);
    await fs.mkdir(path.dirname(directory));
    await fs.symlink(target, directory);

    await expect(writeIdentityCredentialArtifact(artifact)).rejects.toThrow(
      'CREDENTIAL_OUTPUT_DIRECTORY_INVALID',
    );
    expect(await fs.readdir(target)).toEqual([]);
  });
});
