import { Challenge, Credential } from 'mppx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  IPaymentMethodsResource,
  ISpendRequestResource,
  MppPaymentResult,
} from '@/resources/interfaces';
import { decodeMppChallenges, MppResource } from '@/resources/mpp';

const REQUEST = {
  amount: '1000',
  currency: 'usd',
  decimals: 2,
  paymentMethodTypes: ['card'],
  networkId: 'net_001',
};
const CHALLENGE: Challenge.Challenge = {
  id: 'ch_001',
  realm: 'merchant.example',
  method: 'stripe',
  intent: 'charge',
  request: REQUEST,
  expires: '2099-01-01T00:00:00Z',
};
const HEADER = Challenge.serialize(CHALLENGE);

function challengeResponse(header = HEADER): Response {
  return new Response('payment required', {
    status: 402,
    headers: { 'www-authenticate': header },
  });
}

function resource(
  fetch: typeof globalThis.fetch,
  spendRequests: ISpendRequestResource = {} as ISpendRequestResource,
  paymentMethods: IPaymentMethodsResource = {} as IPaymentMethodsResource,
) {
  return new MppResource(
    { accessToken: 'test_token', fetch },
    { spendRequests, paymentMethods },
  );
}

function payWithSharedPaymentToken(
  mpp: MppResource,
  options: {
    url: string;
    method?: string;
    body?: string;
    headers?: HeadersInit;
    sharedPaymentToken: string;
    approvedChallenge?: string;
  },
): Promise<MppPaymentResult> {
  const internal = mpp as unknown as {
    payWithSharedPaymentToken(value: typeof options): Promise<MppPaymentResult>;
  };
  return internal.payWithSharedPaymentToken(options);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('MppResource', () => {
  it('decodes stripe charge and session challenges for SDK consumers', () => {
    expect(decodeMppChallenges(HEADER)).toMatchObject([
      {
        id: 'ch_001',
        method: 'stripe',
        network_id: 'net_001',
        request_json: { amount: '1000', currency: 'usd' },
      },
    ]);
  });

  it('decodes methodDetails.networkId and rejects malformed challenges', () => {
    const header = Challenge.serialize({
      ...CHALLENGE,
      intent: 'session',
      request: {
        ...REQUEST,
        networkId: undefined,
        methodDetails: { networkId: 'net_nested' },
      },
    });
    expect(decodeMppChallenges(header)).toMatchObject([
      {
        intent: 'session',
        network_id: 'net_nested',
      },
    ]);
    expect(() =>
      decodeMppChallenges(
        'Payment id="x", realm="r", method="tempo", intent="charge", request="e30="',
      ),
    ).toThrow(/stripe charge or session/);
  });

  it('returns every supported challenge and ignores unsupported methods', () => {
    const secondStripe = Challenge.serialize({
      ...CHALLENGE,
      id: 'ch_002',
      intent: 'session',
    });
    const tempo = Challenge.serialize({
      id: 'tempo_001',
      realm: 'merchant.example',
      method: 'tempo',
      intent: 'charge',
      request: { amount: '1000000', currency: '0x01' },
    });

    expect(
      decodeMppChallenges([tempo, HEADER, secondStripe].join(', ')),
    ).toMatchObject([
      { id: 'ch_001', method: 'stripe', intent: 'charge' },
      { id: 'ch_002', method: 'stripe', intent: 'session' },
    ]);
  });

  it('rejects non-loopback HTTP before making a request', async () => {
    const fetch = vi.fn();
    await expect(
      resource(fetch).probe({ url: 'http://merchant.example/pay' }),
    ).rejects.toThrow(/require HTTPS/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('follows safe probe redirects and strips cross-origin credentials', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 307,
          headers: { location: 'https://merchant.example/pay' },
        }),
      )
      .mockResolvedValueOnce(new Response('ok'));
    const probe = await resource(fetch).probe({
      url: 'https://redirector.example/start',
      method: 'PUT',
      body: 'payload',
      headers: { Authorization: 'Bearer secret', 'Content-Type': 'text/plain' },
    });
    expect(probe.url).toBe('https://merchant.example/pay');
    expect(probe.method).toBe('PUT');
    expect(probe.body).toBe('payload');
    expect(probe.headers.get('authorization')).toBeNull();
  });

  it('turns a same-origin 303 into GET and drops body headers', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 303,
          headers: { location: '/challenge' },
        }),
      )
      .mockResolvedValueOnce(new Response('ok'));
    const probe = await resource(fetch).probe({
      url: 'https://merchant.example/start',
      method: 'PUT',
      body: 'payload',
      headers: { 'Content-Type': 'text/plain' },
    });
    expect(probe).toMatchObject({
      url: 'https://merchant.example/challenge',
      method: 'GET',
    });
    expect(probe.body).toBeUndefined();
    expect(probe.headers.has('content-type')).toBe(false);
  });

  it('rejects HTTPS downgrade redirects', async () => {
    const redirected = new Response('redirect', {
      status: 302,
      headers: { location: 'http://127.0.0.1:8080/pay' },
    });
    const fetch = vi.fn().mockResolvedValue(redirected);
    await expect(
      resource(fetch).probe({ url: 'https://merchant.example/start' }),
    ).rejects.toThrow(/HTTPS downgrade/);
    expect(redirected.bodyUsed).toBe(true);
  });

  it('signs and submits a stripe charge with a shared payment token', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(challengeResponse())
      .mockResolvedValueOnce(new Response('paid'));
    const result = await payWithSharedPaymentToken(resource(fetch), {
      url: 'https://merchant.example/pay',
      sharedPaymentToken: 'spt_test_123',
    });
    expect(result).toMatchObject({ status: 200, body: 'paid' });
    const headers = new Headers(fetch.mock.calls[1]![1]?.headers);
    const credential = Credential.deserialize(headers.get('authorization')!);
    expect(credential.payload).toEqual({ spt: 'spt_test_123' });
  });

  it('replaces caller authorization and refuses paid redirects', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(challengeResponse())
      .mockResolvedValueOnce(
        new Response(null, {
          status: 307,
          headers: { location: 'https://other.example/pay' },
        }),
      );
    await expect(
      payWithSharedPaymentToken(resource(fetch), {
        url: 'https://merchant.example/pay',
        sharedPaymentToken: 'spt_test_123',
        headers: { Authorization: 'Bearer caller-value' },
      }),
    ).rejects.toThrow(/redirect 307/);
    const headers = new Headers(fetch.mock.calls[1]![1]?.headers);
    expect(headers.get('authorization')).toMatch(/^Payment /);
    expect(fetch.mock.calls[1]![1]?.redirect).toBe('manual');
  });

  it('supports stripe session challenges', async () => {
    const sessionHeader = Challenge.serialize({
      ...CHALLENGE,
      intent: 'session',
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(challengeResponse(sessionHeader))
      .mockResolvedValueOnce(new Response('opened'));
    await payWithSharedPaymentToken(resource(fetch), {
      url: 'https://merchant.example/session',
      sharedPaymentToken: 'spt_test_123',
    });
    const headers = new Headers(fetch.mock.calls[1]![1]?.headers);
    const credential = Credential.deserialize(headers.get('authorization')!);
    expect(credential.payload).toEqual({
      action: 'open',
      grantedToken: 'spt_test_123',
    });
  });

  it('refuses a changed challenge after approval', async () => {
    const changed = Challenge.serialize({
      ...CHALLENGE,
      request: { ...REQUEST, amount: '2000' },
    });
    const response = challengeResponse(changed);
    const fetch = vi.fn().mockResolvedValueOnce(response);
    await expect(
      payWithSharedPaymentToken(resource(fetch), {
        url: 'https://merchant.example/pay',
        sharedPaymentToken: 'spt_test_123',
        approvedChallenge: HEADER,
      }),
    ).rejects.toThrow(/challenge changed after approval/);
    expect(fetch).toHaveBeenCalledOnce();
    expect(response.bodyUsed).toBe(true);
  });

  it('accepts refreshed challenge IDs and expiration changes', async () => {
    const refreshed = Challenge.serialize({
      ...CHALLENGE,
      id: 'ch_002',
      expires: undefined,
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(challengeResponse(refreshed))
      .mockResolvedValueOnce(new Response('paid'));
    await expect(
      payWithSharedPaymentToken(resource(fetch), {
        url: 'https://merchant.example/pay',
        sharedPaymentToken: 'spt_test_123',
        approvedChallenge: HEADER,
      }),
    ).resolves.toMatchObject({ body: 'paid' });
    const headers = new Headers(fetch.mock.calls[1]![1]?.headers);
    expect(
      Credential.deserialize(headers.get('authorization')!).challenge.id,
    ).toBe('ch_002');
  });

  it.each([
    ['currency', { request: { ...REQUEST, currency: 'eur' } }],
    ['network', { request: { ...REQUEST, networkId: 'net_002' } }],
    ['intent', { intent: 'session' }],
    ['realm', { realm: 'other.example' }],
    ['description', { description: 'Different purchase' }],
    ['credential header', { header: 'Payment-Credential' }],
  ])('refuses a changed approved %s', async (_name, change) => {
    const changed = Challenge.serialize({ ...CHALLENGE, ...change });
    const response = challengeResponse(changed);
    const fetch = vi.fn().mockResolvedValueOnce(response);
    await expect(
      payWithSharedPaymentToken(resource(fetch), {
        url: 'https://merchant.example/pay',
        sharedPaymentToken: 'spt_test_123',
        approvedChallenge: HEADER,
      }),
    ).rejects.toThrow(/challenge changed after approval/);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('validates the spend request before retrieving its credential', async () => {
    const retrieve = vi.fn().mockResolvedValue({
      id: 'lsrq_123',
      status: 'pending_approval',
      credential_type: 'shared_payment_token',
    });
    await expect(
      resource(vi.fn(), {
        retrieve,
      } as unknown as ISpendRequestResource).pay({
        url: 'https://merchant.example/pay',
        spendRequestId: 'lsrq_123',
      }),
    ).rejects.toThrow(/must be approved/);
  });

  it('retrieves an approved spend request and waits for SPT propagation', async () => {
    vi.useFakeTimers();
    const retrieve = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'lsrq_123',
        status: 'approved',
        credential_type: 'shared_payment_token',
      })
      .mockResolvedValueOnce({
        id: 'lsrq_123',
        status: 'approved',
        credential_type: 'shared_payment_token',
      })
      .mockResolvedValueOnce({
        id: 'lsrq_123',
        status: 'approved',
        credential_type: 'shared_payment_token',
        shared_payment_token: { id: 'spt_test_123' },
      });
    const spendRequests = { retrieve } as unknown as ISpendRequestResource;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(challengeResponse())
      .mockResolvedValueOnce(new Response('paid'));
    const promise = resource(fetch, spendRequests).pay({
      url: 'https://merchant.example/pay',
      spendRequestId: 'lsrq_123',
      challenge: HEADER,
    });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toMatchObject({ body: 'paid' });
    expect(retrieve).toHaveBeenCalledTimes(3);
  });

  it('returns a serializable continuation when creating a spend request', async () => {
    const spendRequests = {
      create: vi.fn().mockResolvedValue({
        id: 'lsrq_123',
        status: 'pending_approval',
        approval_url: 'https://link.com/approve/lsrq_123',
      }),
    } as unknown as ISpendRequestResource;
    const fetch = vi.fn().mockResolvedValueOnce(challengeResponse());
    const prepared = await resource(fetch, spendRequests).createSpendRequest({
      url: 'https://merchant.example/pay',
      context:
        'Buy the selected item from the merchant after the user reviews and approves this exact request.',
      paymentMethodId: 'pm_123',
    });
    expect(prepared).toMatchObject({
      request: {
        url: 'https://merchant.example/pay',
        method: 'GET',
        headers: {},
      },
      approvedChallenge: HEADER,
      spendRequest: { id: 'lsrq_123' },
    });
    expect(JSON.parse(JSON.stringify(prepared))).toEqual(prepared);
  });
});
