import Link from '@/client';
import { PaymentMethodsResource } from '@/resources/payment-methods';
import { ReportResource } from '@/resources/report';
import { SpendRequestResource } from '@/resources/spend-request';
import { TransactionsResource } from '@/resources/transactions';
import { WebBotAuthResource } from '@/resources/web-bot-auth';
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
    expect(client.transactions).toBeInstanceOf(TransactionsResource);
    expect(client.webBotAuth).toBeInstanceOf(WebBotAuthResource);
    expect(client.reports).toBeInstanceOf(ReportResource);
    expect(client.spendRequests.create).toBeTypeOf('function');
    expect(client.spendRequests.update).toBeTypeOf('function');
    expect(client.spendRequests.retrieve).toBeTypeOf('function');
    expect(client.paymentMethods.list).toBeTypeOf('function');
    expect(client.transactions.list).toBeTypeOf('function');
  });
});
