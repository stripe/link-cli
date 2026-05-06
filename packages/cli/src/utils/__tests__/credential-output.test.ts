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
});
