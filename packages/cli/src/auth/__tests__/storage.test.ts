import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Conf from 'conf';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type PendingDeviceAuth, Storage } from '../storage';
import type { AuthTokens } from '../types';

interface LegacyStorageSchema {
  auth: AuthTokens | null;
  pendingDeviceAuth: PendingDeviceAuth | null;
}

const describePosix = process.platform === 'win32' ? describe.skip : describe;

describePosix('CLI auth storage', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'link-cli-storage-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads credentials written by the pre-branch-4 storage', () => {
    const tokens: AuthTokens = {
      access_token: 'at_existing',
      refresh_token: 'rt_existing',
      expires_in: 3600,
      expires_at: Date.now() + 3_600_000,
      token_type: 'Bearer',
      scope: 'userinfo:read payment_methods.agentic',
    };
    const pendingDeviceAuth: PendingDeviceAuth = {
      device_code: 'dc_existing',
      interval: 5,
      expires_at: Date.now() + 60_000,
      verification_url: 'https://login.link.com/device',
      phrase: 'existing-phrase',
    };
    const legacyStorage = new Conf<LegacyStorageSchema>({
      projectName: 'link-cli',
      cwd: tmpDir,
      configFileMode: 0o600,
      defaults: { auth: null, pendingDeviceAuth: null },
    });
    legacyStorage.set('auth', tokens);
    legacyStorage.set('pendingDeviceAuth', pendingDeviceAuth);

    const storage = new Storage({ cwd: tmpDir });

    expect(storage.getPath()).toBe(legacyStorage.path);
    expect(storage.getTokens()).toEqual(tokens);
    expect(storage.getPendingDeviceAuth()).toEqual(pendingDeviceAuth);
  });

  it('implements the SDK token-storage contract', () => {
    const storage = new Storage({ cwd: tmpDir });

    storage.setTokens({
      access_token: 'at_test',
      refresh_token: 'rt_test',
      expires_in: 3600,
      token_type: 'Bearer',
    });

    expect(storage.getTokens()?.access_token).toBe('at_test');
    expect(storage.getTokens()?.expires_at).toBeTypeOf('number');
    storage.clearTokens();
    expect(storage.getTokens()).toBeNull();
  });

  it('writes credentials with mode 0o600', () => {
    const storage = new Storage({ cwd: tmpDir });

    storage.setTokens({
      access_token: 'at_test',
      refresh_token: 'rt_test',
      expires_in: 3600,
      token_type: 'Bearer',
    });

    expect(fs.statSync(storage.getPath()).mode & 0o777).toBe(0o600);
  });

  it('repairs an existing config file with broader permissions', () => {
    const seedStorage = new Storage({ cwd: tmpDir });
    seedStorage.setTokens({
      access_token: 'at_seed',
      refresh_token: 'rt_seed',
      expires_in: 3600,
      token_type: 'Bearer',
    });
    const configPath = seedStorage.getPath();
    fs.chmodSync(configPath, 0o644);

    const upgradedStorage = new Storage({ cwd: tmpDir });
    upgradedStorage.setTokens({
      access_token: 'at_after_upgrade',
      refresh_token: 'rt_after_upgrade',
      expires_in: 3600,
      token_type: 'Bearer',
    });

    expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it('uses an explicit credential path in preference to cwd', () => {
    const customPath = path.join(tmpDir, 'custom-creds.json');
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'link-cli-other-'));
    const storage = new Storage({ configPath: customPath, cwd: otherDir });

    storage.setTokens({
      access_token: 'at_custom',
      refresh_token: 'rt_custom',
      expires_in: 3600,
      token_type: 'Bearer',
    });

    expect(storage.getPath()).toBe(customPath);
    expect(storage.getTokens()?.access_token).toBe('at_custom');
    expect(fs.statSync(customPath).mode & 0o777).toBe(0o600);
    fs.rmSync(otherDir, { recursive: true, force: true });
  });

  it('keeps pending CLI workflow state out of the SDK token contract', () => {
    const storage = new Storage({ cwd: tmpDir });

    storage.setPendingDeviceAuth({
      device_code: 'dc_test_must_not_leak',
      interval: 5,
      expires_at: Date.now() + 60_000,
      verification_url: 'https://login.link.com/device',
      phrase: 'test-phrase',
      replaces_existing_session: true,
    });

    expect(storage.getPendingDeviceAuth()?.replaces_existing_session).toBe(
      true,
    );
    expect(fs.statSync(storage.getPath()).mode & 0o777).toBe(0o600);
  });
});
