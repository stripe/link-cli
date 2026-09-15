import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttestationExport } from '../export';
import { writeAttestationArtifact } from '../storage';

const artifact: AttestationExport = {
  version: 1,
  issuer: 'https://api.link.com',
  token_key_id: 'key-id',
  count: 1,
  tokens: [{ token: 'token', authorization: 'PrivateToken token="token"' }],
};

describe('attestation artifact storage', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'link-attestations-'));
    vi.spyOn(os, 'homedir').mockReturnValue(tmpDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates unique artifacts in a private directory', async () => {
    const directory = path.join(tmpDir, '.link-cli', 'attestations');
    const first = await writeAttestationArtifact(artifact);
    const second = await writeAttestationArtifact(artifact);

    expect(first).not.toBe(second);
    expect(path.dirname(first)).toBe(directory);
    expect(JSON.parse(await fs.readFile(first, 'utf8'))).toEqual(artifact);
    expect((await fs.stat(directory)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(first)).mode & 0o777).toBe(0o600);
  });

  it('rejects a symbolic-link output directory', async () => {
    const target = path.join(tmpDir, 'target');
    const directory = path.join(tmpDir, '.link-cli', 'attestations');
    await fs.mkdir(target);
    await fs.mkdir(path.dirname(directory));
    await fs.symlink(target, directory);

    await expect(writeAttestationArtifact(artifact)).rejects.toThrow(
      'ATTESTATION_OUTPUT_DIRECTORY_INVALID',
    );
    expect(await fs.readdir(target)).toEqual([]);
  });
});
