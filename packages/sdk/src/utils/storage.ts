import fs from 'node:fs';
import type { AuthTokens } from '@/types/index';
import Conf from 'conf';

interface StorageSchema {
  auth: AuthTokens | null;
}

export interface AuthStorage {
  getAuth(): AuthTokens | null;
  setAuth(auth: AuthTokens): void;
  clearAuth(): void;
  isAuthenticated(): boolean;
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

  clearAll(): void {
    this.auth = null;
  }

  getPath(): string {
    return 'memory';
  }

  deleteConfig(): void {
    // no-op: nothing to delete in memory
  }
}

export const storage = new Storage();
