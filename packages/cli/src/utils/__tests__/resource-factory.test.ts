import {
  LinkAuthenticationError,
  PaymentMethodsResource,
  SpendRequestResource,
  WebBotAuthResource,
} from '@stripe/link-sdk';
import { describe, expect, it, vi } from 'vitest';
import { LinkAuthResource } from '../../auth/auth-resource';
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
    expect(factory.createWebBotAuthResource()).toBe(
      factory.createWebBotAuthResource(),
    );
    expect(factory.createAuthResource()).toBeInstanceOf(LinkAuthResource);
    expect(factory.createSpendRequestResource()).toBeInstanceOf(
      SpendRequestResource,
    );
    expect(factory.createPaymentMethodsResource()).toBeInstanceOf(
      PaymentMethodsResource,
    );
    expect(factory.createWebBotAuthResource()).toBeInstanceOf(
      WebBotAuthResource,
    );
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
