import { describe, expect, it, vi } from 'vitest';
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
  it('caches resource instances', () => {
    const factory = new ResourceFactory();

    expect(factory.createAuthResource()).toBe(factory.createAuthResource());
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
    expect(factory.createSpendRequestResource().create).toBeTypeOf('function');
    expect(factory.createPaymentMethodsResource().list).toBeTypeOf('function');
    expect(factory.createBalancesResource().list).toBeTypeOf('function');
    expect(factory.createWebBotAuthResource().signUrl).toBeTypeOf('function');
  });

  it('applies default User-Agent on merchant fetch unless the caller set one', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response());
    const factory = new ResourceFactory({
      fetch: mockFetch,
      defaultHeaders: { 'User-Agent': 'link-cli/0.14.0 (GrokBot)' },
    });

    await factory.getMerchantFetch()('https://merchant.example/pay', {
      method: 'GET',
    });
    await factory.getMerchantFetch()('https://merchant.example/pay', {
      method: 'GET',
      headers: { 'User-Agent': 'CustomBot/1.0' },
    });

    expect(
      new Headers(mockFetch.mock.calls[0][1].headers).get('User-Agent'),
    ).toBe('link-cli/0.14.0 (GrokBot)');
    expect(
      new Headers(mockFetch.mock.calls[1][1].headers).get('User-Agent'),
    ).toBe('CustomBot/1.0');
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
