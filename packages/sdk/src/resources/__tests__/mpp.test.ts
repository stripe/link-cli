import { Challenge, Credential } from 'mppx';
import { Mppx } from 'mppx/server/core';
import { stripe } from 'mppx/stripe/server/spt';
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
  return new MppResource({ accessToken: 'test_token', fetch }, spendRequests);
}

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

afterEach(() => {
  vi.useRealTimers();
});

describe('decodeMppChallenges', () => {
  it('decodes a stripe charge challenge', () => {
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

  it('rejects non-loopback HTTP before making a request', async () => {
    const fetch = vi.fn();
    await expect(
      resource(fetch).decode({ url: 'http://merchant.example/pay' }),
    ).rejects.toThrow(/require HTTPS/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns the request after redirects without cross-origin credentials', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 307,
          headers: { location: 'https://merchant.example/pay' },
        }),
      )
      .mockResolvedValueOnce(challengeResponse());
    const decoded = await resource(fetch).decode({
      url: 'https://redirector.example/start',
      method: 'PUT',
      body: 'payload',
      headers: { Authorization: 'Bearer secret', 'x-order': 'ord_1' },
    });
    expect(decoded).toMatchObject({
      payment_required: true,
      request: {
        url: 'https://merchant.example/pay',
        method: 'PUT',
        body: 'payload',
        headers: { 'x-order': 'ord_1' },
      },
    });
    expect(decoded).not.toHaveProperty('request.headers.authorization');
  });

  it('rejects HTTPS downgrade redirects', async () => {
    const redirected = new Response('redirect', {
      status: 302,
      headers: { location: 'http://127.0.0.1:8080/pay' },
    });
    const fetch = vi.fn().mockResolvedValue(redirected);
    await expect(
      resource(fetch).decode({ url: 'https://merchant.example/start' }),
    ).rejects.toThrow(/HTTPS downgrade/);
    expect(redirected.bodyUsed).toBe(true);
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

  it('pays an mppx seller with rotating issuance nonces', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'pi_test_123',
      status: 'succeeded',
    });
    const seller = Mppx.create({
      secretKey: 'test-secret-key-test-secret-key-32',
      realm: CHALLENGE.realm,
      methods: [
        stripe.spt({
          client: { paymentIntents: { create } },
          networkId: 'profile_test_repro',
          paymentMethodTypes: ['card'],
        }),
      ],
    });
    const handler = seller.charge({
      amount: '0.75',
      currency: 'usd',
      decimals: 2,
      meta: { order: 'order_123' },
      expires: CHALLENGE.expires,
    });
    const challenges: Challenge.Challenge[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const result = await handler(new Request(input, init));
      if (result.status === 402) {
        challenges.push(Challenge.fromResponse(result.challenge));
        return result.challenge;
      }
      return result.withReceipt(new Response('paid'));
    });
    const retrieve = vi
      .fn()
      .mockResolvedValue(
        approvedSpendRequest({ amount: 75, network_id: 'profile_test_repro' }),
      );
    const mpp = resource(fetch, {
      retrieve,
    } as unknown as ISpendRequestResource);
    const request = { url: 'https://merchant.example/pay' };

    await expect(mpp.decode(request)).resolves.toMatchObject({
      payment_required: true,
    });
    await expect(
      mpp.pay(request, { spendRequestId: 'lsrq_123' }),
    ).resolves.toMatchObject({ status: 200, body: 'paid' });

    expect(challenges).toHaveLength(2);
    expect(challenges[0]?.opaque).not.toBe(challenges[1]?.opaque);
    expect(fetch).toHaveBeenCalledTimes(3);
    const credential = Credential.deserialize(
      new Headers(fetch.mock.calls[2]?.[1]?.headers).get('authorization') ?? '',
    );
    expect(credential.challenge).toEqual(challenges[1]);
    expect(create).toHaveBeenCalledTimes(1);
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

  it('refuses to pay when the re-fetched challenge redirected to a different origin', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 307,
          headers: { location: 'https://merchant.example/pay' },
        }),
      )
      .mockResolvedValueOnce(challengeResponse());
    const retrieve = vi.fn();
    await expect(
      resource(fetch, { retrieve } as unknown as ISpendRequestResource).pay(
        { url: 'https://redirector.example/start' },
        { spendRequestId: 'lsrq_123' },
      ),
    ).rejects.toThrow(/different origin/);
    expect(fetch).toHaveBeenCalledTimes(2);
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

  it('refuses to pay a spend request that is not approved', async () => {
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
