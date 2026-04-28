import fs from 'node:fs';
import type { AuthTokens } from '@/types/index';
import Conf from 'conf';

export interface PendingDeviceAuth {
  device_code: string;
  interval: number;
  expires_at: number;
  verification_url: string;
  phrase: string;
}

interface StorageSchema {
  auth: AuthTokens | null;
  pendingDeviceAuth: PendingDeviceAuth | null;
}

export interface AuthStorage {
  getAuth(): AuthTokens | null;
  setAuth(auth: AuthTokens): void;
  clearAuth(): void;
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

class Storage implements AuthStorage {
  private config?: Conf<StorageSchema>;

  private getConfig(): Conf<StorageSchema> {
    if (!this.config) {
      this.config = new Conf<StorageSchema>({
        projectName: 'link-cli',
        defaults: {
          auth: null,
          pendingDeviceAuth: null,
        },
      });
    }

    return this.config;
  }

  getAuth(): AuthTokens | null {
    return this.getConfig().get('auth');
  }

  setAuth(auth: AuthTokens): void {
    this.getConfig().set('auth', withComputedExpiry(auth));
  }

  clearAuth(): void {
    this.getConfig().set('auth', null);
  }

  isAuthenticated(): boolean {
    return this.getAuth() !== null;
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
      // file already gone or inaccessible — treat as success
    }
  }
}

export class MemoryStorage implements AuthStorage {
  private auth: AuthTokens | null;
  private pendingAuth: PendingDeviceAuth | null = null;

  constructor(initialAuth: AuthTokens | null = null) {
    this.auth = initialAuth ? withComputedExpiry(initialAuth) : null;
  }

  getAuth(): AuthTokens | null {
    return this.auth;
  }

  setAuth(auth: AuthTokens): void {
    this.auth = withComputedExpiry(auth);
  }

  clearAuth(): void {
    this.auth = null;
  }

  isAuthenticated(): boolean {
    return this.auth !== null;
  }

  getPendingDeviceAuth(): PendingDeviceAuth | null {
    if (!this.pendingAuth) return null;
    if (Date.now() >= this.pendingAuth.expires_at) {
      this.pendingAuth = null;
      return null;
    }
    return this.pendingAuth;
  }

  setPendingDeviceAuth(pending: PendingDeviceAuth): void {
    this.pendingAuth = pending;
  }

  clearPendingDeviceAuth(): void {
    this.pendingAuth = null;
  }

  clearAll(): void {
    this.auth = null;
    this.pendingAuth = null;
  }

  getPath(): string {
    return 'memory';
  }

  deleteConfig(): void {
    // no-op: nothing to delete in memory
  }
}

export const storage = new Storage();
