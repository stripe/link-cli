import { Challenge, Credential } from 'mppx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ISpendRequestResource } from '@/resources/interfaces';
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
) {
  return new MppResource(
    { accessToken: 'test_token', fetch },
    { spendRequests },
  );
}

// The spend request's amount/currency/network_id match REQUEST above
// (1000 cents, usd, net_001) so happy-path tests can share it.
function approvedSpendRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lsrq_123',
    status: 'approved',
    credential_type: 'shared_payment_token',
    amount: 1000,
    currency: 'usd',
    network_id: 'net_001',
    shared_payment_token: { id: 'spt_test_123' },
    ...overrides,
  };
}

function probeRequest(
  mpp: MppResource,
  options: {
    url: string;
    method?: string;
    body?: string;
    headers?: HeadersInit;
  },
) {
  const internal = mpp as unknown as {
    probe(o: typeof options): Promise<{
      url: string;
      method: string;
      headers: Headers;
      body?: string;
      response: Response;
    }>;
  };
  return internal.probe(options);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('decodeMppChallenges', () => {
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
});

describe('MppResource#probe (used internally by decode and pay)', () => {
  it('rejects non-loopback HTTP before making a request', async () => {
    const fetch = vi.fn();
    await expect(
      probeRequest(resource(fetch), { url: 'http://merchant.example/pay' }),
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
    const probe = await probeRequest(resource(fetch), {
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
    const probe = await probeRequest(resource(fetch), {
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
      probeRequest(resource(fetch), { url: 'https://merchant.example/start' }),
    ).rejects.toThrow(/HTTPS downgrade/);
    expect(redirected.bodyUsed).toBe(true);
  });
});

describe('MppResource#decode', () => {
  it('returns parsed challenges for a supported 402', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(challengeResponse());
    const decoded = await resource(fetch).decode({
      url: 'https://merchant.example/pay',
    });
    expect(decoded).toMatchObject({
      payment_required: true,
      challenges: [{ id: 'ch_001', method: 'stripe', network_id: 'net_001' }],
    });
  });

  it('returns the response as-is when payment is not required', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('ok'));
    const decoded = await resource(fetch).decode({
      url: 'https://merchant.example/pay',
    });
    expect(decoded).toEqual({
      payment_required: false,
      response: {
        status: 200,
        headers: { 'content-type': 'text/plain;charset=UTF-8' },
        body: 'ok',
      },
    });
  });
});

describe('MppResource#pay', () => {
  it('signs and submits a stripe charge with a shared payment token', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(challengeResponse())
      .mockResolvedValueOnce(new Response('paid'));
    const retrieve = vi.fn().mockResolvedValue(approvedSpendRequest());
    const result = await resource(fetch, {
      retrieve,
    } as unknown as ISpendRequestResource).pay(
      { url: 'https://merchant.example/pay' },
      { spendRequestId: 'lsrq_123' },
    );
    expect(result).toMatchObject({ status: 200, body: 'paid' });
    const headers = new Headers(fetch.mock.calls[1]![1]?.headers);
    const credential = Credential.deserialize(headers.get('authorization')!);
    expect(credential.payload).toEqual({ spt: 'spt_test_123' });
  });

  it('includes the challenge external ID in the payment credential', async () => {
    const header = Challenge.serialize({
      ...CHALLENGE,
      request: { ...REQUEST, externalId: 'order_123' },
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(challengeResponse(header))
      .mockResolvedValueOnce(new Response('paid'));
    const retrieve = vi.fn().mockResolvedValue(approvedSpendRequest());

    await resource(fetch, { retrieve } as unknown as ISpendRequestResource).pay(
      { url: 'https://merchant.example/pay' },
      { spendRequestId: 'lsrq_123' },
    );

    const headers = new Headers(fetch.mock.calls[1]![1]?.headers);
    const credential = Credential.deserialize(headers.get('authorization')!);
    expect(credential.payload).toEqual({
      spt: 'spt_test_123',
      externalId: 'order_123',
    });
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
    const retrieve = vi.fn().mockResolvedValue(approvedSpendRequest());
    await expect(
      resource(fetch, { retrieve } as unknown as ISpendRequestResource).pay(
        {
          url: 'https://merchant.example/pay',
          headers: { Authorization: 'Bearer caller-value' },
        },
        { spendRequestId: 'lsrq_123' },
      ),
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
    const retrieve = vi.fn().mockResolvedValue(approvedSpendRequest());
    await resource(fetch, { retrieve } as unknown as ISpendRequestResource).pay(
      { url: 'https://merchant.example/session' },
      { spendRequestId: 'lsrq_123' },
    );
    const headers = new Headers(fetch.mock.calls[1]![1]?.headers);
    const credential = Credential.deserialize(headers.get('authorization')!);
    expect(credential.payload).toEqual({
      action: 'open',
      grantedToken: 'spt_test_123',
    });
  });

  // mppx re-issues a fresh challenge (new id/opaque nonce) on every probe, so
  // the challenge seen at pay-time routinely differs from the one seen when
  // the spend request was created. Since approval is no longer pinned to a
  // specific challenge (only to the spend request's own terms), a rotated
  // nonce or new challenge id must not block payment. Regression test for #490.
  it('pays using the freshly re-fetched challenge even when its id, expiration, or nonce differ', async () => {
    const rotated = Challenge.serialize({
      ...CHALLENGE,
      id: 'ch_002',
      expires: undefined,
      opaque: 'cm90YXRlZA==',
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(challengeResponse(rotated))
      .mockResolvedValueOnce(new Response('paid'));
    const retrieve = vi.fn().mockResolvedValue(approvedSpendRequest());
    await expect(
      resource(fetch, { retrieve } as unknown as ISpendRequestResource).pay(
        { url: 'https://merchant.example/pay' },
        { spendRequestId: 'lsrq_123' },
      ),
    ).resolves.toMatchObject({ body: 'paid' });
    const headers = new Headers(fetch.mock.calls[1]![1]?.headers);
    expect(
      Credential.deserialize(headers.get('authorization')!).challenge.id,
    ).toBe('ch_002');
  });

  it('returns the re-fetched response without paying when it is no longer a 402', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('already complete'));
    const retrieve = vi.fn();
    const result = await resource(fetch, {
      retrieve,
    } as unknown as ISpendRequestResource).pay(
      { url: 'https://merchant.example/pay' },
      { spendRequestId: 'lsrq_123' },
    );
    expect(result).toMatchObject({ status: 200, body: 'already complete' });
    expect(retrieve).not.toHaveBeenCalled();
  });

  it.each([
    ['amount', { amount: 2000 }],
    ['currency', { currency: 'eur' }],
    ['network ID', { network_id: 'net_002' }],
  ])(
    'refuses to pay when the spend request %s does not match the fresh challenge',
    async (_field, change) => {
      const fetch = vi.fn().mockResolvedValueOnce(challengeResponse());
      const retrieve = vi.fn().mockResolvedValue(approvedSpendRequest(change));
      await expect(
        resource(fetch, { retrieve } as unknown as ISpendRequestResource).pay(
          { url: 'https://merchant.example/pay' },
          { spendRequestId: 'lsrq_123' },
        ),
      ).rejects.toThrow(/does not match/);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('validates the spend request before retrieving its credential', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(challengeResponse());
    const retrieve = vi.fn().mockResolvedValue({
      id: 'lsrq_123',
      status: 'pending_approval',
      credential_type: 'shared_payment_token',
    });
    await expect(
      resource(fetch, { retrieve } as unknown as ISpendRequestResource).pay(
        { url: 'https://merchant.example/pay' },
        { spendRequestId: 'lsrq_123' },
      ),
    ).rejects.toThrow(/must be approved/);
  });

  it('retrieves an approved spend request and waits for SPT propagation', async () => {
    vi.useFakeTimers();
    const retrieve = vi
      .fn()
      .mockResolvedValueOnce(
        approvedSpendRequest({ shared_payment_token: undefined }),
      )
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
    const promise = resource(fetch, spendRequests).pay(
      { url: 'https://merchant.example/pay' },
      { spendRequestId: 'lsrq_123' },
    );
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toMatchObject({ body: 'paid' });
    expect(retrieve).toHaveBeenCalledTimes(3);
  });
});
