import Link, { LinkClient } from '@/client';
import { PaymentMethodsResource } from '@/resources/payment-methods';
import { SpendRequestResource } from '@/resources/spend-request';
import { describe, expect, it, vi } from 'vitest';

describe('Link', () => {
  it('exposes a top-level SDK surface backed by shared repositories', () => {
    const client = new Link({
      accessToken: 'test_token',
      fetch: vi.fn(),
      apiBaseUrl: 'https://api.example.com',
    });

    expect(client.spendRequests).toBeInstanceOf(SpendRequestResource);
    expect(client.paymentMethods).toBeInstanceOf(PaymentMethodsResource);
    expect(client.spendRequests.create).toBeTypeOf('function');
    expect(client.spendRequests.update).toBeTypeOf('function');
    expect(client.spendRequests.retrieve).toBeTypeOf('function');
    expect(client.paymentMethods.list).toBeTypeOf('function');
  });

  it('keeps LinkClient as a compatibility alias', () => {
    expect(LinkClient).toBe(Link);
  });
});
