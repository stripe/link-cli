import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeCredentialFile } from '../credential-output';

describe('writeCredentialFile', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'link-cli-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes JSON file with 0600 permissions', async () => {
    const filePath = path.join(tmpDir, 'card.json');
    const data = { number: '4000009990001984', cvc: '123' };
    const result = await writeCredentialFile(filePath, data, false);
    expect(result).toBe(filePath);
    const contents = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    expect(contents).toEqual(data);
    const stat = await fs.stat(filePath);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('refuses to overwrite existing file without force', async () => {
    const filePath = path.join(tmpDir, 'card.json');
    await fs.writeFile(filePath, 'existing');
    await expect(writeCredentialFile(filePath, {}, false)).rejects.toThrow(
      'OUTPUT_FILE_EXISTS',
    );
  });

  it('overwrites existing file with force', async () => {
    const filePath = path.join(tmpDir, 'card.json');
    await fs.writeFile(filePath, 'old');
    await writeCredentialFile(filePath, { new: true }, true);
    const contents = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    expect(contents).toEqual({ new: true });
  });

  it('resolves relative paths to absolute', async () => {
    const filePath = path.join(tmpDir, 'card.json');
    const result = await writeCredentialFile(filePath, {}, false);
    expect(path.isAbsolute(result)).toBe(true);
  });

  // The output file holds full card credentials. A pre-existing symbolic
  // link at the user's --output-file path lets an attacker on a shared
  // filesystem redirect the credential write through the link target.
  // Refusing to follow the link closes the cross-user exfiltration vector.
  // --force does not authorize symlink replacement: an operator who wants
  // to overwrite a regular output file gets that, but a symlink at the
  // path is rejected outright in either mode.

  it('refuses to write through a symbolic link without force', async () => {
    const filePath = path.join(tmpDir, 'card.json');
    const targetPath = path.join(tmpDir, 'target.json');
    await fs.writeFile(targetPath, '{}');
    await fs.symlink(targetPath, filePath);

    await expect(
      writeCredentialFile(filePath, { num: 1 }, false),
    ).rejects.toThrow('OUTPUT_FILE_SYMLINK');
    // The symlink target must not have been written.
    expect(await fs.readFile(targetPath, 'utf-8')).toBe('{}');
    // The symlink itself must still be in place.
    expect((await fs.lstat(filePath)).isSymbolicLink()).toBe(true);
  });

  it('refuses to overwrite a symbolic link even with --force', async () => {
    const filePath = path.join(tmpDir, 'card.json');
    const targetPath = path.join(tmpDir, 'target.json');
    await fs.writeFile(targetPath, '{}');
    await fs.symlink(targetPath, filePath);

    // --force is intended to replace an existing regular output file. It
    // does not authorize destroying a symlink the operator may not have
    // intended to remove, nor writing credentials over its target.
    await expect(
      writeCredentialFile(filePath, { num: 1 }, true),
    ).rejects.toThrow('OUTPUT_FILE_SYMLINK');
    // The symlink target must not have been written.
    expect(await fs.readFile(targetPath, 'utf-8')).toBe('{}');
    // The symlink itself must still be in place.
    expect((await fs.lstat(filePath)).isSymbolicLink()).toBe(true);
  });

  it('produces a 0o600 file even when force is set', async () => {
    // Mode is set at create time via the open() third argument, with
    // O_EXCL guaranteeing the file is created here. Validates the mode
    // path explicitly because the legacy chmod-after-write step is gone.
    const filePath = path.join(tmpDir, 'card.json');
    await fs.writeFile(filePath, 'old', { mode: 0o644 });
    await writeCredentialFile(filePath, { x: 1 }, true);
    const stat = await fs.stat(filePath);
    expect(stat.mode & 0o777).toBe(0o600);
  });
});
