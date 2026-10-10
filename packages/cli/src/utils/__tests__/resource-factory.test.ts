import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LinkAuthResource } from '../../auth/auth-resource';
import { LinkAuthenticationError } from '../../auth/errors';
import type { IAuthResource } from '../../auth/types';
import { ResourceFactory } from '../resource-factory';

function createMockAuthResource(
  refreshResult = {
    access_token: 'at_refreshed',
    refresh_token: 'rt_refreshed',
    expires_in: 3600,
    token_type: 'Bearer',
  },
): IAuthResource {
  return {
    initiateDeviceAuth: vi.fn(),
    pollDeviceAuth: vi.fn(),
    refreshToken: vi.fn(async () => refreshResult),
    revokeToken: vi.fn(async () => {}),
  };
}

describe('ResourceFactory', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('caches resource instances', () => {
    const factory = new ResourceFactory();

    expect(factory.createAuthResource()).toBe(factory.createAuthResource());
    expect(factory.createAttestationsResource()).toBe(
      factory.createAttestationsResource(),
    );
    expect(factory.createIdentityCredentialsResource()).toBe(
      factory.createIdentityCredentialsResource(),
    );
    expect(factory.createSpendRequestResource()).toBe(
      factory.createSpendRequestResource(),
    );
    expect(factory.createPaymentMethodsResource()).toBe(
      factory.createPaymentMethodsResource(),
    );
    expect(factory.createBalancesResource()).toBe(
      factory.createBalancesResource(),
    );
    expect(factory.createWebBotAuthResource()).toBe(
      factory.createWebBotAuthResource(),
    );
    expect(factory.createAuthResource()).toBeInstanceOf(LinkAuthResource);
    expect(factory.createAttestationsResource().request).toBeTypeOf('function');
    expect(factory.createIdentityCredentialsResource().issue).toBeTypeOf(
      'function',
    );
    expect(factory.createSpendRequestResource().create).toBeTypeOf('function');
    expect(factory.createPaymentMethodsResource().list).toBeTypeOf('function');
    expect(factory.createBalancesResource().list).toBeTypeOf('function');
    expect(factory.createWebBotAuthResource().signUrl).toBeTypeOf('function');
  });

  it('loads the configured module for proxy requests', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'link-cli-proxy-'));
    const modulePath = join(directory, 'undici.cjs');
    writeFileSync(
      modulePath,
      'exports.ProxyAgent = class { constructor(url) { this.url = url; } };',
    );
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ payment_details: [] }));
    vi.stubGlobal('fetch', fetch);
    vi.stubEnv('LINK_HTTP_PROXY', 'http://proxy.test:8080');
    vi.stubEnv('LINK_UNDICI_MODULE', modulePath);
    vi.stubEnv('LINK_API_BASE_URL', 'https://api.example.test');

    try {
      const factory = new ResourceFactory({ envAccessToken: 'at_env' });
      await expect(
        factory.createPaymentMethodsResource().list(),
      ).resolves.toEqual([]);
      const dispatcher = expect.objectContaining({
        url: 'http://proxy.test:8080',
      });
      expect(fetch).toHaveBeenCalledExactlyOnceWith(
        'https://api.example.test/payment-details',
        expect.objectContaining({ dispatcher }),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  describe('env-based token provider', () => {
    it('returns LINK_ACCESS_TOKEN directly', async () => {
      const factory = new ResourceFactory({ envAccessToken: 'at_env' });
      const provider = factory.getAccessTokenProvider();

      expect(await provider()).toBe('at_env');
    });

    it('throws on forceRefresh when LINK_REFRESH_TOKEN is not set', async () => {
      const factory = new ResourceFactory({ envAccessToken: 'at_env' });
      const provider = factory.getAccessTokenProvider();

      await expect(provider({ forceRefresh: true })).rejects.toThrow(
        LinkAuthenticationError,
      );
    });

    it('throws on forceRefresh when LINK_NO_REFRESH is set', async () => {
      const mockAuth = createMockAuthResource();
      const factory = new ResourceFactory({
        envAccessToken: 'at_env',
        envRefreshToken: 'rt_env',
        noRefresh: true,
        authResource: mockAuth,
      });
      const provider = factory.getAccessTokenProvider();

      await expect(provider({ forceRefresh: true })).rejects.toThrow(
        LinkAuthenticationError,
      );
      expect(mockAuth.refreshToken).not.toHaveBeenCalled();
    });

    it('refreshes using LINK_REFRESH_TOKEN on forceRefresh', async () => {
      const mockAuth = createMockAuthResource();
      const factory = new ResourceFactory({
        envAccessToken: 'at_env',
        envRefreshToken: 'rt_env',
        authResource: mockAuth,
      });
      const provider = factory.getAccessTokenProvider();

      const token = await provider({ forceRefresh: true });

      expect(token).toBe('at_refreshed');
      expect(mockAuth.refreshToken).toHaveBeenCalledWith('rt_env');
    });
  });
});
