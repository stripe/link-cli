import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MemoryStorage, Storage } from '@/utils/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('MemoryStorage', () => {
  it('computes expires_at when storing auth tokens', () => {
    const authStorage = new MemoryStorage();

    authStorage.setAuth({
      access_token: 'at_123',
      refresh_token: 'rt_123',
      expires_in: 60,
      token_type: 'Bearer',
    });

    const stored = authStorage.getAuth();
    expect(stored?.expires_at).toBeTypeOf('number');
    expect(stored?.expires_at).toBeGreaterThan(Date.now());
  });

  it('can be initialized with an existing auth session', () => {
    const authStorage = new MemoryStorage({
      access_token: 'at_123',
      refresh_token: 'rt_123',
      expires_in: 60,
      token_type: 'Bearer',
    });

    expect(authStorage.isAuthenticated()).toBe(true);
    expect(authStorage.getPath()).toBe('memory');
  });

  it('deleteConfig is a no-op for MemoryStorage', () => {
    const authStorage = new MemoryStorage({
      access_token: 'at_123',
      refresh_token: 'rt_123',
      expires_in: 60,
      token_type: 'Bearer',
    });
    expect(() => authStorage.deleteConfig()).not.toThrow();
    // auth is unaffected
    expect(authStorage.isAuthenticated()).toBe(true);
  });
});

// Skip on Windows: POSIX file modes don't apply (NTFS uses ACLs and the
// stat.mode bits don't reflect the actual access controls).
const describePosix = process.platform === 'win32' ? describe.skip : describe;

describePosix('Storage (disk-backed) file permissions', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'link-cli-storage-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes the config file with mode 0o600 (owner-only)', () => {
    const storage = new Storage({ cwd: tmpDir });

    storage.setAuth({
      access_token: 'at_test',
      refresh_token: 'rt_test',
      expires_in: 3600,
      token_type: 'Bearer',
    });

    const mode = fs.statSync(storage.getPath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  // The fix must also remediate users who were created on a prior version that
  // wrote the file with the conf default (0o666 masked by umask, typically
  // 0o644). conf writes via atomic rename, so the new mode applies on the
  // next write — no explicit chmod needed.
  it('rewrites with mode 0o600 when an existing file is 0o644', () => {
    const seedStorage = new Storage({ cwd: tmpDir });
    // Trigger initial write so we know where the file lives.
    seedStorage.setAuth({
      access_token: 'at_seed',
      refresh_token: 'rt_seed',
      expires_in: 3600,
      token_type: 'Bearer',
    });
    const configPath = seedStorage.getPath();
    fs.chmodSync(configPath, 0o644);
    expect(fs.statSync(configPath).mode & 0o777).toBe(0o644);

    // Simulate a CLI invocation after the upgrade: a new Storage instance
    // opens the same file and writes (e.g., via a refreshed token).
    const upgradedStorage = new Storage({ cwd: tmpDir });
    upgradedStorage.setAuth({
      access_token: 'at_after_upgrade',
      refresh_token: 'rt_after_upgrade',
      expires_in: 3600,
      token_type: 'Bearer',
    });

    expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it('also restricts pendingDeviceAuth, which is written to the same file', () => {
    const storage = new Storage({ cwd: tmpDir });

    storage.setPendingDeviceAuth({
      device_code: 'dc_test_must_not_leak',
      interval: 5,
      expires_at: Date.now() + 60_000,
      verification_url: 'https://login.link.com/device',
      phrase: 'test-phrase',
    });

    const mode = fs.statSync(storage.getPath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
