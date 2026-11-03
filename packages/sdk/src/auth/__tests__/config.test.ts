import { afterEach, describe, expect, it } from 'vitest';
import {
  requireFetchImplementation,
  resolveAuthResourceConfig,
} from '@/auth/config';
import { LinkConfigurationError } from '@/errors';

const CLIENT_ID = 'test_client_id';

describe('resolveAuthResourceConfig', () => {
  const origEnv = process.env.LINK_AUTH_BASE_URL;
  const hadEnv = 'LINK_AUTH_BASE_URL' in process.env;

  afterEach(() => {
    if (hadEnv) {
      process.env.LINK_AUTH_BASE_URL = origEnv;
    } else {
      delete process.env.LINK_AUTH_BASE_URL;
    }
  });

  it('uses default values when no options provided', () => {
    const config = resolveAuthResourceConfig({ clientId: CLIENT_ID });

    expect(config.clientId).toBe(CLIENT_ID);
    expect(config.verbose).toBe(false);
    expect(config.clientName).toBe('Link CLI');
    expect(config.authBaseUrl).toBe('https://login.link.com');
    expect(config.logger).toBeDefined();
  });

  it('respects explicit options', () => {
    const config = resolveAuthResourceConfig({
      clientId: CLIENT_ID,
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
    const config = resolveAuthResourceConfig({ clientId: CLIENT_ID });

    expect(config.authBaseUrl).toBe('https://env.auth');
  });

  it('explicit option overrides env var', () => {
    process.env.LINK_AUTH_BASE_URL = 'https://env.auth';
    const config = resolveAuthResourceConfig({
      clientId: CLIENT_ID,
      authBaseUrl: 'https://explicit.auth',
    });

    expect(config.authBaseUrl).toBe('https://explicit.auth');
  });

  it('uses custom defaults', () => {
    const config = resolveAuthResourceConfig(
      { clientId: CLIENT_ID },
      { authBaseUrl: 'https://custom.auth' },
    );

    expect(config.authBaseUrl).toBe('https://custom.auth');
  });

  it('throws LinkConfigurationError when clientId is missing', () => {
    expect(() => resolveAuthResourceConfig({ clientId: '' })).toThrow(
      LinkConfigurationError,
    );
  });
});

describe('requireFetchImplementation', () => {
  it('returns fetch when available', () => {
    const mockFetch = (() => {}) as unknown as typeof globalThis.fetch;
    expect(requireFetchImplementation({ fetch: mockFetch })).toBe(mockFetch);
  });

  it('throws LinkConfigurationError when fetch is undefined', () => {
    const config: { fetch?: typeof globalThis.fetch } = {};
    expect(() => requireFetchImplementation(config)).toThrow(
      LinkConfigurationError,
    );
  });
});
