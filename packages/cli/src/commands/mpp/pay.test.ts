import type {
  IMppResource,
  ISpendRequestResource,
  MppDecodeResult,
} from '@stripe/link-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildUserAgent } from '../../utils/user-agent';
import { buildHeaders, runMppPayFullFlow } from './pay';

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
  request: { url: 'https://merchant.example/challenge', method: 'GET' },
};

beforeEach(() => {
  vi.stubGlobal('__CLI_VERSION__', 'test');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('buildHeaders', () => {
  it('defaults to JSON when a body is supplied, including an empty body', () => {
    expect(
      buildHeaders('{"hello":"world"}', undefined).get('content-type'),
    ).toBe('application/json');
    expect(buildHeaders('', undefined).get('content-type')).toBe(
      'application/json',
    );
    expect(buildHeaders(undefined, undefined).has('content-type')).toBe(false);
  });

  it.each(['content-type', 'Content-Type', 'CONTENT-TYPE'])(
    'replaces the default with an explicit %s without duplication',
    (name) => {
      const headers = buildHeaders('{}', [`${name}: application/json`]);
      expect(headers.get('content-type')).toBe('application/json');
      const overridden = buildHeaders('{}', [`${name}: text/plain`]);
      expect(overridden.get('content-type')).toBe('text/plain');
    },
  );

  it('preserves the default user agent and case-insensitive explicit overrides', () => {
    expect(buildHeaders(undefined, undefined).get('user-agent')).toBe(
      buildUserAgent('test', process.env),
    );
    expect(
      buildHeaders(undefined, ['user-agent: custom-agent']).get('user-agent'),
    ).toBe('custom-agent');
  });
});

describe('runMppPayFullFlow', () => {
  it.each([
    { approve: false, useApprovalPolicy: false },
    { approve: true, useApprovalPolicy: false },
    { approve: false, useApprovalPolicy: true },
    { approve: true, useApprovalPolicy: true },
  ])(
    'creates a spend request with approve=$approve and useApprovalPolicy=$useApprovalPolicy',
    async ({ approve, useApprovalPolicy }) => {
      const repository = approvedRepository();

      await runFullFlow(repository, 1000, approve, useApprovalPolicy);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          approve: approve || useApprovalPolicy || undefined,
          use_approval_policy: useApprovalPolicy || undefined,
        }),
      );
    },
  );

  it('rejects an explicit amount that conflicts with the challenge', async () => {
    const repository = approvedRepository();

    await expect(runFullFlow(repository, 2000)).rejects.toThrow(
      '--amount must match the MPP challenge amount (1000)',
    );
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('returns the decoded response as-is when payment is not required', async () => {
    const mppResource = mpp({
      payment_required: false,
      response: { status: 200, headers: {}, body: 'already complete' },
    });

    await expect(
      runFullFlow(approvedRepository(), 1000, false, false, mppResource),
    ).resolves.toMatchObject({ status: 200, body: 'already complete' });
    expect(mppResource.pay).not.toHaveBeenCalled();
  });

  it('pays the resolved request decode() found the challenge at, not the original URL', async () => {
    const mppResource = mpp({
      ...DECODED,
      request: { url: 'https://merchant.example/resolved', method: 'GET' },
    });

    await runFullFlow(approvedRepository(), 1000, false, false, mppResource);

    expect(mppResource.pay).toHaveBeenCalledWith(
      { url: 'https://merchant.example/resolved', method: 'GET' },
      { spendRequestId: 'lsrq_123' },
    );
  });
});

function mpp(decoded: MppDecodeResult = DECODED) {
  return {
    decode: vi.fn().mockResolvedValue(decoded),
    pay: vi.fn().mockResolvedValue({ status: 200, headers: {}, body: 'paid' }),
  } as unknown as IMppResource;
}

function approvedRepository() {
  return {
    create: vi.fn().mockResolvedValue({
      id: 'lsrq_123',
      status: 'pending_approval',
    }),
    retrieve: vi.fn().mockResolvedValue({ id: 'lsrq_123', status: 'approved' }),
  } as unknown as ISpendRequestResource;
}

function runFullFlow(
  repository: ISpendRequestResource,
  amountOverride = 1000,
  approve = false,
  useApprovalPolicy = false,
  mppResource = mpp(),
) {
  return runMppPayFullFlow({
    url: 'https://merchant.example/challenge',
    method: 'GET',
    data: undefined,
    headers: undefined,
    context:
      'Buy a test item from the merchant after explicit Link approval for this machine payment request.',
    amountOverride,
    paymentMethodId: 'pd_test_123',
    test: true,
    approve,
    useApprovalPolicy,
    mpp: mppResource,
    repository,
    paymentMethodsFactory: vi.fn(),
  });
}
