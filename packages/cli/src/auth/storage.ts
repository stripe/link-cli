import fs from 'node:fs';
import path from 'node:path';
import Conf from 'conf';
import type { AuthStorage, AuthTokens } from './types';

export interface PendingDeviceAuth {
  device_code: string;
  interval: number;
  expires_at: number;
  verification_url: string;
  phrase: string;
  // `auth upgrade` keeps the old session valid until this authorization wins.
  replaces_existing_session?: boolean;
}

interface StorageSchema {
  auth: AuthTokens | null;
  pendingDeviceAuth: PendingDeviceAuth | null;
}

/** Storage for CLI credentials plus CLI-specific login workflow state. */
export interface CliAuthStorage extends AuthStorage {
  getTokens(): AuthTokens | null;
  setTokens(tokens: AuthTokens): void;
  clearTokens(): void;
  isAuthenticated(): boolean;
  getPendingDeviceAuth(): PendingDeviceAuth | null;
  setPendingDeviceAuth(pending: PendingDeviceAuth): void;
  clearPendingDeviceAuth(): void;
  clearAll(): void;
  getPath(): string;
  deleteConfig(): void;
}

function withComputedExpiry(auth: AuthTokens): AuthTokens {
  return {
    ...auth,
    expires_at: auth.expires_at ?? Date.now() + auth.expires_in * 1000,
  };
}

const CONFIG_FILE_MODE = 0o600;

export interface StorageOptions {
  cwd?: string;
  configPath?: string;
}

export class Storage implements CliAuthStorage {
  private config?: Conf<StorageSchema>;
  private readonly options: StorageOptions;

  constructor(options: StorageOptions = {}) {
    this.options = options;
  }

  private getConfig(): Conf<StorageSchema> {
    if (!this.config) {
      let locationOverride: { cwd: string; configName?: string } | undefined;
      if (this.options.configPath) {
        const parsed = path.parse(path.resolve(this.options.configPath));
        const configName = parsed.ext === '.json' ? parsed.name : parsed.base;
        locationOverride = { cwd: parsed.dir, configName };
      } else if (this.options.cwd) {
        locationOverride = { cwd: this.options.cwd };
      }

      this.config = new Conf<StorageSchema>({
        projectName: 'link-cli',
        configFileMode: CONFIG_FILE_MODE,
        ...locationOverride,
        defaults: {
          auth: null,
          pendingDeviceAuth: null,
        },
      });
    }

    return this.config;
  }

  getTokens(): AuthTokens | null {
    return this.getConfig().get('auth');
  }

  setTokens(tokens: AuthTokens): void {
    this.getConfig().set('auth', withComputedExpiry(tokens));
  }

  clearTokens(): void {
    this.getConfig().set('auth', null);
  }

  isAuthenticated(): boolean {
    return this.getTokens() !== null;
  }

  getPendingDeviceAuth(): PendingDeviceAuth | null {
    const pending = this.getConfig().get('pendingDeviceAuth');
    if (!pending) return null;
    if (Date.now() >= pending.expires_at) {
      this.clearPendingDeviceAuth();
      return null;
    }
    return pending;
  }

  setPendingDeviceAuth(pending: PendingDeviceAuth): void {
    this.getConfig().set('pendingDeviceAuth', pending);
  }

  clearPendingDeviceAuth(): void {
    this.getConfig().set('pendingDeviceAuth', null);
  }

  clearAll(): void {
    this.getConfig().clear();
  }

  getPath(): string {
    return this.getConfig().path;
  }

  deleteConfig(): void {
    try {
      fs.unlinkSync(this.getPath());
    } catch {
      // File already gone or inaccessible; local logout is still complete.
    }
  }
}

export const storage = new Storage();
