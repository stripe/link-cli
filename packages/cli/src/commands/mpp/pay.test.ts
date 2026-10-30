import type {
  IMppResource,
  IPaymentMethodsResource,
  ISpendRequestResource,
  MppDecodeResult,
} from '@stripe/link-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildUserAgent } from '../../utils/user-agent';
import { buildHeaders, runMppPayFullFlow } from './pay';

beforeEach(() => {
  vi.stubGlobal('__CLI_VERSION__', 'test');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildHeaders', () => {
  it('sets JSON content type for a body and replaces it case insensitively', () => {
    expect(buildHeaders('', undefined).get('content-type')).toBe(
      'application/json',
    );
    expect(buildHeaders(undefined, undefined).has('content-type')).toBe(false);
    expect(
      buildHeaders('{}', ['content-type: text/plain']).get('content-type'),
    ).toBe('text/plain');
  });

  it('adds the CLI user agent unless the caller supplied one', () => {
    expect(buildHeaders(undefined, undefined).get('user-agent')).toBe(
      buildUserAgent('test', process.env),
    );
    expect(
      buildHeaders(undefined, ['user-agent: custom-agent']).get('user-agent'),
    ).toBe('custom-agent');
  });
});

const DECODED: MppDecodeResult = {
  payment_required: true,
  challenges: [
    {
      id: 'ch_001',
      realm: 'merchant.example',
      method: 'stripe',
      intent: 'charge',
      network_id: 'net_001',
      request_json: { amount: '1000', currency: 'usd' },
    },
  ],
  request: { url: 'https://merchant.example/pay', method: 'GET' },
};

function mpp(decoded: MppDecodeResult = DECODED) {
  return {
    decode: vi.fn().mockResolvedValue(decoded),
    pay: vi.fn().mockResolvedValue({ status: 200, headers: {}, body: 'paid' }),
  } as unknown as IMppResource;
}

function paymentMethodsFactory() {
  return vi.fn().mockReturnValue({
    list: vi.fn().mockResolvedValue([{ id: 'pm_test_123' }]),
  } as unknown as IPaymentMethodsResource);
}

function runFullFlow(
  overrides: Partial<Parameters<typeof runMppPayFullFlow>[0]> = {},
) {
  return runMppPayFullFlow({
    url: 'https://merchant.example/pay',
    method: undefined,
    data: undefined,
    headers: undefined,
    context:
      'Buy a test item from the merchant after explicit Link approval for this machine payment request.',
    amountOverride: undefined,
    paymentMethodId: 'pd_test_123',
    test: false,
    approve: false,
    useApprovalPolicy: false,
    mpp: mpp(),
    spendRequests: {} as ISpendRequestResource,
    paymentMethodsFactory: paymentMethodsFactory(),
    ...overrides,
  });
}

describe('runMppPayFullFlow', () => {
  it('returns the decoded response as-is when payment is not required', async () => {
    const mppResource = mpp({
      payment_required: false,
      response: { status: 200, headers: {}, body: 'already complete' },
    });
    const result = await runFullFlow({ mpp: mppResource });
    expect(result).toMatchObject({ status: 200, body: 'already complete' });
    expect(mppResource.pay).not.toHaveBeenCalled();
  });

  it('rejects an explicit amount that conflicts with the decoded challenge', async () => {
    const create = vi.fn();
    await expect(
      runFullFlow({
        amountOverride: 2000,
        spendRequests: { create } as unknown as ISpendRequestResource,
      }),
    ).rejects.toThrow('--amount must match the MPP challenge amount (1000)');
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    { approve: false, useApprovalPolicy: false },
    { approve: true, useApprovalPolicy: false },
    { approve: false, useApprovalPolicy: true },
    { approve: true, useApprovalPolicy: true },
  ])(
    'creates a spend request with approve=$approve and useApprovalPolicy=$useApprovalPolicy',
    async ({ approve, useApprovalPolicy }) => {
      const create = vi
        .fn()
        .mockResolvedValue({ id: 'lsrq_123', status: 'approved' });
      await runFullFlow({
        approve,
        useApprovalPolicy,
        spendRequests: { create } as unknown as ISpendRequestResource,
      });
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          approve: approve || useApprovalPolicy || undefined,
          use_approval_policy: useApprovalPolicy || undefined,
        }),
      );
    },
  );

  it('skips approval polling and pays immediately when the spend request is already approved', async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ id: 'lsrq_123', status: 'approved' });
    const retrieve = vi.fn();
    const mppResource = mpp();
    await expect(
      runFullFlow({
        mpp: mppResource,
        spendRequests: { create, retrieve } as unknown as ISpendRequestResource,
      }),
    ).resolves.toMatchObject({ status: 200, body: 'paid' });
    expect(retrieve).not.toHaveBeenCalled();
    expect(mppResource.pay).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://merchant.example/pay' }),
      { spendRequestId: 'lsrq_123' },
    );
  });

  it('pays the resolved request decode() found the challenge at, not the original URL', async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ id: 'lsrq_123', status: 'approved' });
    const mppResource = mpp({
      ...DECODED,
      request: { url: 'https://merchant.example/resolved', method: 'GET' },
    });
    await runFullFlow({
      mpp: mppResource,
      spendRequests: { create } as unknown as ISpendRequestResource,
    });
    expect(mppResource.pay).toHaveBeenCalledWith(
      { url: 'https://merchant.example/resolved', method: 'GET' },
      { spendRequestId: 'lsrq_123' },
    );
  });

  it('polls for approval before paying when the spend request is not yet approved', async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ id: 'lsrq_123', status: 'pending_approval' });
    const retrieve = vi
      .fn()
      .mockResolvedValue({ id: 'lsrq_123', status: 'approved' });
    const mppResource = mpp();
    await expect(
      runFullFlow({
        mpp: mppResource,
        spendRequests: { create, retrieve } as unknown as ISpendRequestResource,
      }),
    ).resolves.toMatchObject({ status: 200, body: 'paid' });
    expect(retrieve).toHaveBeenCalledWith('lsrq_123');
    expect(mppResource.pay).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://merchant.example/pay' }),
      { spendRequestId: 'lsrq_123' },
    );
  });
});
