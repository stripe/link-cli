import { LinkConfigurationError } from '@stripe/link-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import {
  requireFetchImplementation,
  resolveAuthResourceConfig,
} from '../config';

describe('resolveAuthResourceConfig', () => {
  const origEnv = process.env.LINK_AUTH_BASE_URL;
  const hadEnv = 'LINK_AUTH_BASE_URL' in process.env;

  afterEach(() => {
    if (hadEnv) {
      process.env.LINK_AUTH_BASE_URL = origEnv;
    } else {
      // biome-ignore lint/performance/noDelete: must truly remove env var, not set to "undefined"
      delete process.env.LINK_AUTH_BASE_URL;
    }
  });

  it('uses default values when no options provided', () => {
    const config = resolveAuthResourceConfig();

    expect(config.verbose).toBe(false);
    expect(config.clientName).toBe('Link CLI');
    expect(config.authBaseUrl).toBe('https://login.link.com');
    expect(config.logger).toBeDefined();
  });

  it('respects explicit options', () => {
    const config = resolveAuthResourceConfig({
      verbose: true,
      clientName: 'Test Agent',
      authBaseUrl: 'https://custom.auth',
    });

    expect(config.verbose).toBe(true);
    expect(config.clientName).toBe('Test Agent');
    expect(config.authBaseUrl).toBe('https://custom.auth');
  });

  it('reads LINK_AUTH_BASE_URL env var', () => {
    process.env.LINK_AUTH_BASE_URL = 'https://env.auth';
    const config = resolveAuthResourceConfig();

    expect(config.authBaseUrl).toBe('https://env.auth');
  });

  it('explicit option overrides env var', () => {
    process.env.LINK_AUTH_BASE_URL = 'https://env.auth';
    const config = resolveAuthResourceConfig({
      authBaseUrl: 'https://explicit.auth',
    });

    expect(config.authBaseUrl).toBe('https://explicit.auth');
  });

  it('uses custom defaults', () => {
    const config = resolveAuthResourceConfig(
      {},
      { authBaseUrl: 'https://custom.auth' },
    );

    expect(config.authBaseUrl).toBe('https://custom.auth');
  });
});

describe('requireFetchImplementation', () => {
  it('returns fetch when available', () => {
    const mockFetch = (() => {}) as unknown as typeof globalThis.fetch;
    expect(requireFetchImplementation({ fetch: mockFetch })).toBe(mockFetch);
  });

  it('throws LinkConfigurationError when fetch is undefined', () => {
    expect(() => requireFetchImplementation({ fetch: undefined })).toThrow(
      LinkConfigurationError,
    );
  });
});
