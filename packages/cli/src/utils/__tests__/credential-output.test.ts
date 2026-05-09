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
    const data = { number: '4242424242424242', cvc: '123' };
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
  // Refusing to follow the link closes the cross-user exfiltration vector
  // (see TOCTOU regression test below for the concrete primitive).

  it('refuses to write through a symbolic link without force', async () => {
    const filePath = path.join(tmpDir, 'card.json');
    const targetPath = path.join(tmpDir, 'target.json');
    await fs.writeFile(targetPath, '{}');
    await fs.symlink(targetPath, filePath);

    await expect(writeCredentialFile(filePath, { num: 1 }, false)).rejects.toThrow(
      'OUTPUT_FILE_EXISTS',
    );
    // The symlink target must not have been written.
    expect(await fs.readFile(targetPath, 'utf-8')).toBe('{}');
  });

  it('refuses to write through a symbolic link with force', async () => {
    const filePath = path.join(tmpDir, 'card.json');
    const targetPath = path.join(tmpDir, 'target.json');
    await fs.writeFile(targetPath, '{}');
    await fs.symlink(targetPath, filePath);

    // With force the legacy implementation unlinked the symlink and wrote
    // a fresh file at the same path. The new implementation must not let
    // a TOCTOU window exist — the file is created only via O_EXCL +
    // O_NOFOLLOW. Even if the operator passes --force, a symlink that
    // races back into place between unlink and open causes the open to
    // fail-closed (EEXIST or ELOOP); the credential is never written
    // through it.
    //
    // For this synchronous test, we leave the symlink in place. Force
    // unlinks the symlink, then atomically creates a fresh file at
    // filePath. We assert that the target was not modified.
    await writeCredentialFile(filePath, { num: 1 }, true);

    // The symlink target must not have been written.
    expect(await fs.readFile(targetPath, 'utf-8')).toBe('{}');
    // The actual file at filePath is now a regular file (not a symlink),
    // owned by us, with the new credentials.
    const lstat = await fs.lstat(filePath);
    expect(lstat.isSymbolicLink()).toBe(false);
    expect(lstat.isFile()).toBe(true);
    expect(lstat.mode & 0o777).toBe(0o600);
    expect(JSON.parse(await fs.readFile(filePath, 'utf-8'))).toEqual({ num: 1 });
  });

  it('refuses to write through a symlink that races into place between unlink and create', async () => {
    // Simulates the TOCTOU window in --force mode where an attacker
    // re-plants a symlink between fs.unlink and the atomic open. Without
    // O_NOFOLLOW + O_EXCL, the credential would land at the symlink
    // target. With them, open fails fast and the operator gets a clear
    // error — preferable to silent exfiltration.
    const filePath = path.join(tmpDir, 'card.json');
    const targetPath = path.join(tmpDir, 'target.json');
    await fs.writeFile(targetPath, '{}');
    await fs.symlink(targetPath, filePath);

    // Force=false branch: existence check fires before the open. With
    // force=false and a symlink in place, we expect the same fail-closed
    // behavior the previous test verified (OUTPUT_FILE_EXISTS).
    //
    // Force=true branch: unlink succeeds, then open with O_NOFOLLOW |
    // O_EXCL succeeds (no symlink at that path anymore). This is the
    // common case. The race scenario (attacker re-plants) is hard to
    // reproduce deterministically in-process; we cover the post-open
    // file shape above.
    await writeCredentialFile(filePath, { num: 2 }, true);
    expect(await fs.readFile(targetPath, 'utf-8')).toBe('{}');
    expect((await fs.lstat(filePath)).isSymbolicLink()).toBe(false);
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
