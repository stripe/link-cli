import type { ISpendRequestResource } from '@stripe/link-sdk';
import { Challenge, Credential } from 'mppx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AapCredentialProvider,
  payWithSpt,
  prepareMppProbe,
  runMppPayFullFlow,
  runMppPayWithSpendRequest,
} from './pay';
import { createMppRequest } from './request';

const STRIPE_REQUEST = {
  amount: '1000',
  currency: 'usd',
  decimals: 2,
  paymentMethodTypes: ['card'],
  networkId: 'net_001',
};

const STRIPE_CHALLENGE: Challenge.Challenge = {
  id: 'ch_001',
  realm: 'merchant.example',
  method: 'stripe',
  intent: 'charge',
  request: STRIPE_REQUEST,
  expires: '2099-01-01T00:00:00Z',
};

const WWW_AUTHENTICATE_STRIPE = Challenge.serialize(STRIPE_CHALLENGE);

function challengeWith(overrides: Partial<Challenge.Challenge> = {}): string {
  return Challenge.serialize({
    ...STRIPE_CHALLENGE,
    ...overrides,
    request: overrides.request ?? STRIPE_REQUEST,
  });
}

function challengeResponse(
  challengeHeader = WWW_AUTHENTICATE_STRIPE,
): Response {
  return new Response('{"error":"payment required"}', {
    status: 402,
    headers: { 'www-authenticate': challengeHeader },
  });
}

function challengeResponseWithCredentialHeader(header: string): Response {
  return challengeResponse(
    WWW_AUTHENTICATE_STRIPE.replace(
      'intent="charge",',
      `intent="charge", header="${header}",`,
    ),
  );
}

function accessChallengeResponse(
  overrides: Record<string, unknown> = {},
): Response {
  return new Response(
    JSON.stringify({
      type: 'urn:aap:claims-required',
      aud: 'https://merchant.example',
      nonce: 'challenge-nonce',
      claims: ['email'],
      formats: ['dc+sd-jwt'],
      trusted_issuers: ['https://api.link.com'],
      ...overrides,
    }),
    {
      status: 401,
      headers: {
        'content-type': 'application/problem+json',
        'www-authenticate':
          'PrivateToken challenge="stable", token-key="link-key", max-age=300, Identity-Presentation',
      },
    },
  );
}

function aapCredentialProvider(): AapCredentialProvider {
  let presentationCount = 0;
  let attestationCount = 0;
  return {
    presentIdentityCredential: vi.fn().mockImplementation(async () => ({
      presentation: `identity-presentation-secret-${++presentationCount}`,
    })),
    takeAttestation: vi.fn().mockImplementation(async () => ({
      authorization: `PrivateToken token="attestation-secret-${++attestationCount}"`,
    })),
  } as unknown as AapCredentialProvider;
}

beforeEach(() => {
  vi.stubGlobal('__CLI_VERSION__', 'test');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('payWithSpt', () => {
  it('answers access challenges, then presents identity and payment credentials together', async () => {
    const repository = approvedRepository();
    const credentialProvider = aapCredentialProvider();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(accessChallengeResponse())
      .mockResolvedValueOnce(
        challengeResponseWithCredentialHeader('Payment-Authorization'),
      )
      .mockResolvedValueOnce(accessChallengeResponse())
      .mockResolvedValueOnce(
        challengeResponseWithCredentialHeader('Payment-Authorization'),
      )
      .mockResolvedValueOnce(accessChallengeResponse())
      .mockResolvedValueOnce(new Response('paid'));
    vi.stubGlobal('fetch', fetcher);

    await expect(
      runFullFlow(repository, 1000, credentialProvider),
    ).resolves.toMatchObject({ status: 200, body: 'paid' });

    expect(credentialProvider.presentIdentityCredential).toHaveBeenCalledWith({
      aud: 'https://merchant.example',
      nonce: 'challenge-nonce',
      claim: ['email'],
    });
    expect(credentialProvider.takeAttestation).toHaveBeenCalledTimes(3);

    const accessHeaders = new Headers(fetcher.mock.calls[1][1]?.headers);
    expect(accessHeaders.get('authorization')).toBe(
      'PrivateToken token="attestation-secret-1"',
    );
    expect(accessHeaders.get('identity-presentation')).toBe(
      'identity-presentation-secret-1',
    );
    expect(accessHeaders.has('payment-authorization')).toBe(false);

    const [paidInput, paidInit] = fetcher.mock.calls.at(-1) ?? [];
    const paidHeaders = new Headers(
      paidInput instanceof Request ? paidInput.headers : paidInit?.headers,
    );
    expect(paidHeaders.get('authorization')).toBe(
      'PrivateToken token="attestation-secret-3"',
    );
    expect(paidHeaders.get('identity-presentation')).toBe(
      'identity-presentation-secret-3',
    );
    expect(paidHeaders.get('payment-authorization')).toMatch(/^Payment /);
  });

  it('does not carry ephemeral identity credentials in a continuation probe', async () => {
    const credentialProvider = aapCredentialProvider();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(accessChallengeResponse())
      .mockResolvedValueOnce(
        challengeResponseWithCredentialHeader('Payment-Authorization'),
      );

    const prepared = await prepareMppProbe(
      createMppRequest('https://merchant.example/contribute', 'POST', '{}', {
        'content-type': 'application/json',
      }),
      fetcher,
      credentialProvider,
    );

    expect(prepared.ephemeralHeaderNames).toEqual([
      'identity-presentation',
      'authorization',
    ]);
    const continuationHeaders = [...prepared.probe.headers].filter(
      ([name]) => !prepared.ephemeralHeaderNames.includes(name),
    );
    expect(continuationHeaders).toEqual([
      ['accept-payment', 'stripe/charge, stripe/session'],
      ['content-type', 'application/json'],
    ]);
  });

  it('rejects a claims audience mismatch before consuming an attestation', async () => {
    const credentialProvider = aapCredentialProvider();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        accessChallengeResponse({ aud: 'https://attacker.example' }),
      );

    await expect(
      prepareMppProbe(
        createMppRequest(
          'https://merchant.example/contribute',
          'GET',
          undefined,
          {},
        ),
        fetcher,
        credentialProvider,
      ),
    ).rejects.toThrow(/audience does not match/);
    expect(credentialProvider.presentIdentityCredential).not.toHaveBeenCalled();
    expect(credentialProvider.takeAttestation).not.toHaveBeenCalled();
  });

  it('rejects a claims challenge that trusts issuers in addition to Link', async () => {
    const credentialProvider = aapCredentialProvider();
    const fetcher = vi.fn().mockResolvedValueOnce(
      accessChallengeResponse({
        trusted_issuers: ['https://api.link.com', 'https://issuer.example'],
      }),
    );

    await expect(
      prepareMppProbe(
        createMppRequest(
          'https://merchant.example/contribute',
          'GET',
          undefined,
          {},
        ),
        fetcher,
        credentialProvider,
      ),
    ).rejects.toThrow(/challenge body is invalid/);
    expect(credentialProvider.presentIdentityCredential).not.toHaveBeenCalled();
    expect(credentialProvider.takeAttestation).not.toHaveBeenCalled();
  });

  it('requires a separate payment header when Authorization carries an attestation', async () => {
    const credentialProvider = aapCredentialProvider();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(accessChallengeResponse())
      .mockResolvedValueOnce(challengeResponse())
      .mockResolvedValueOnce(challengeResponse());
    vi.stubGlobal('fetch', fetcher);

    await expect(
      runFullFlow(approvedRepository(), 1000, credentialProvider),
    ).rejects.toThrow(/separate credential header/);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('answers a fresh access challenge when continuing an approved spend request', async () => {
    const repository = {
      retrieve: vi.fn().mockResolvedValue({
        id: 'lsrq_123',
        status: 'approved',
        credential_type: 'shared_payment_token',
        shared_payment_token: { id: 'spt_test_123' },
      }),
    } as unknown as ISpendRequestResource;
    const credentialProvider = aapCredentialProvider();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(accessChallengeResponse())
      .mockResolvedValueOnce(
        challengeResponseWithCredentialHeader('Payment-Authorization'),
      )
      .mockResolvedValueOnce(accessChallengeResponse())
      .mockResolvedValueOnce(new Response('paid'));
    vi.stubGlobal('fetch', fetcher);

    await expect(
      runMppPayWithSpendRequest(
        'https://merchant.example/contribute',
        'lsrq_123',
        'POST',
        '{}',
        undefined,
        repository,
        undefined,
        credentialProvider,
      ),
    ).resolves.toMatchObject({ status: 200, body: 'paid' });

    const paidHeaders = new Headers(fetcher.mock.calls.at(-1)?.[1]?.headers);
    expect(paidHeaders.get('authorization')).toMatch(/^PrivateToken /);
    expect(paidHeaders.get('identity-presentation')).toBe(
      'identity-presentation-secret-2',
    );
    expect(paidHeaders.get('payment-authorization')).toMatch(/^Payment /);
  });

  it('rejects a redirect before using an approved credential', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 307,
        headers: { location: 'https://other.example/challenge' },
      }),
    );
    vi.stubGlobal('fetch', fetcher);

    await expect(
      payWithSpt(
        'https://merchant.example/challenge',
        'spt_test_123',
        undefined,
        undefined,
        undefined,
      ),
    ).rejects.toThrow(/redirected with status 307 after approval/);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('https://merchant.example/challenge');
    expect(
      new Headers(fetcher.mock.calls[0][1]?.headers).has('authorization'),
    ).toBe(false);
  });

  it('replaces caller authorization and refuses a redirect after payment', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(challengeResponse())
      .mockResolvedValueOnce(
        new Response(null, {
          status: 307,
          headers: { location: 'https://other.example/payment' },
        }),
      );
    vi.stubGlobal('fetch', fetcher);

    await expect(
      payWithSpt(
        'https://merchant.example/challenge',
        'spt_test_123',
        'POST',
        '{"item":"book"}',
        ['authorization: Bearer caller-value'],
      ),
    ).rejects.toThrow('redirect 307');

    const paidHeaders = new Headers(fetcher.mock.calls[1][1]?.headers);
    expect(
      [...paidHeaders].filter(([name]) => name === 'authorization'),
    ).toEqual([['authorization', expect.stringMatching(/^Payment /)]]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][1]?.redirect).toBe('manual');
    expect(fetcher.mock.calls[1][1]?.body).toBe('{"item":"book"}');
  });

  it('uses the credential header selected by the challenge', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        challengeResponseWithCredentialHeader('Payment-Credential'),
      )
      .mockResolvedValueOnce(new Response('paid'));
    vi.stubGlobal('fetch', fetcher);

    await payWithSpt(
      'https://merchant.example/challenge',
      'spt_test_123',
      undefined,
      undefined,
      undefined,
    );

    const paidHeaders = new Headers(fetcher.mock.calls[1][1]?.headers);
    expect(paidHeaders.get('payment-credential')).toMatch(/^Payment /);
    expect(paidHeaders.has('authorization')).toBe(false);
  });

  it('refreshes an approved challenge at the pinned destination without following redirects', async () => {
    const repository = {
      create: vi.fn().mockResolvedValue({
        id: 'lsrq_123',
        status: 'pending_approval',
      }),
      retrieve: vi
        .fn()
        .mockResolvedValueOnce({ id: 'lsrq_123', status: 'approved' })
        .mockResolvedValueOnce({
          id: 'lsrq_123',
          status: 'approved',
          shared_payment_token: { id: 'spt_test_123' },
        }),
    } as unknown as ISpendRequestResource;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'https://merchant.example/challenge' },
        }),
      )
      .mockResolvedValueOnce(challengeResponse())
      .mockResolvedValueOnce(
        new Response(null, {
          status: 307,
          headers: { location: 'https://other.example/challenge' },
        }),
      );
    vi.stubGlobal('fetch', fetcher);

    await expect(
      runMppPayFullFlow({
        url: 'https://redirector.example/start',
        method: 'GET',
        data: undefined,
        headers: undefined,
        context:
          'Buy a test item from the merchant after explicit Link approval for this machine payment request.',
        amountOverride: 1000,
        paymentMethodId: 'pd_test_123',
        test: true,
        repository,
        paymentMethodsFactory: vi.fn(),
      }),
    ).rejects.toThrow(/redirected with status 307 after approval/);
    expect(
      fetcher.mock.calls.map(([input]) =>
        input instanceof Request ? input.url : input,
      ),
    ).toEqual([
      'https://redirector.example/start',
      'https://merchant.example/challenge',
      'https://merchant.example/challenge',
    ]);
  });

  it('accepts a refreshed challenge with a new id and no expiration when its approved terms match', async () => {
    const repository = approvedRepository();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(challengeResponse())
      .mockResolvedValueOnce(
        challengeResponse(
          challengeWith({
            id: 'ch_002',
            expires: undefined,
          }),
        ),
      )
      .mockResolvedValueOnce(new Response('paid'));
    vi.stubGlobal('fetch', fetcher);

    await expect(runFullFlow(repository)).resolves.toMatchObject({
      status: 200,
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    const credential = Credential.deserialize(
      new Headers(fetcher.mock.calls[2][1]?.headers).get('authorization') ?? '',
    );
    expect(credential.challenge.id).toBe('ch_002');
  });

  it('accepts semantically identical request objects regardless of key order', async () => {
    const approvedRequest = {
      amount: '1000',
      currency: 'usd',
      methodDetails: { networkId: 'net_001', captureMethod: 'automatic' },
      paymentMethodTypes: ['card'],
      decimals: 2,
    };
    const refreshedRequest = {
      decimals: 2,
      paymentMethodTypes: ['card'],
      methodDetails: { captureMethod: 'automatic', networkId: 'net_001' },
      currency: 'usd',
      amount: '1000',
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        challengeResponse(challengeWith({ request: approvedRequest })),
      )
      .mockResolvedValueOnce(
        challengeResponse(
          challengeWith({ id: 'ch_002', request: refreshedRequest }),
        ),
      )
      .mockResolvedValueOnce(new Response('paid'));
    vi.stubGlobal('fetch', fetcher);

    await expect(runFullFlow(approvedRepository())).resolves.toMatchObject({
      status: 200,
      body: 'paid',
    });
  });

  it('returns a refreshed non-payment response without submitting a credential', async () => {
    const refreshedResponse = new Response('already complete');
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(challengeResponse())
      .mockResolvedValueOnce(refreshedResponse);
    vi.stubGlobal('fetch', fetcher);

    await expect(runFullFlow(approvedRepository())).resolves.toEqual({
      status: 200,
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: 'already complete',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['amount', { request: { ...STRIPE_REQUEST, amount: '2000' } }],
    ['currency', { request: { ...STRIPE_REQUEST, currency: 'eur' } }],
    ['decimals', { request: { ...STRIPE_REQUEST, decimals: 6 } }],
    [
      'payment method type',
      { request: { ...STRIPE_REQUEST, paymentMethodTypes: ['bank_account'] } },
    ],
    [
      'payment method list',
      {
        request: {
          ...STRIPE_REQUEST,
          paymentMethodTypes: ['bank_account', 'card'],
        },
      },
    ],
    ['network', { request: { ...STRIPE_REQUEST, networkId: 'net_002' } }],
    [
      'an added request field',
      { request: { ...STRIPE_REQUEST, merchant: 'new' } },
    ],
    [
      'a removed request field',
      {
        request: {
          amount: '1000',
          currency: 'usd',
          paymentMethodTypes: ['card'],
          networkId: 'net_001',
        },
      },
    ],
    ['intent', { intent: 'session' }],
    ['realm', { realm: 'other.example' }],
    ['description', { description: 'Different purchase' }],
    ['request digest', { digest: 'sha-256=ZGlmZmVyZW50' }],
    ['credential header', { header: 'Payment-Credential' }],
    ['opaque metadata', { opaque: 'bWV0YWRhdGE' }],
  ])(
    'rejects a refreshed challenge with changed %s',
    async (_field, change) => {
      const repository = approvedRepository();
      const refreshedResponse = challengeResponse(challengeWith(change));
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(challengeResponse())
        .mockResolvedValueOnce(refreshedResponse);
      vi.stubGlobal('fetch', fetcher);

      await expect(runFullFlow(repository)).rejects.toThrow(
        /challenge changed after approval/,
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(refreshedResponse.bodyUsed).toBe(true);
      for (const [, init] of fetcher.mock.calls) {
        expect(new Headers(init?.headers).has('authorization')).toBe(false);
      }
    },
  );

  it('rejects a changed field nested inside the payment request', async () => {
    const approvedRequest = {
      ...STRIPE_REQUEST,
      methodDetails: { captureMethod: 'automatic', networkId: 'net_001' },
    };
    const refreshedRequest = {
      ...STRIPE_REQUEST,
      methodDetails: { captureMethod: 'manual', networkId: 'net_001' },
    };
    const refreshedResponse = challengeResponse(
      challengeWith({ request: refreshedRequest }),
    );
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        challengeResponse(challengeWith({ request: approvedRequest })),
      )
      .mockResolvedValueOnce(refreshedResponse);
    vi.stubGlobal('fetch', fetcher);

    await expect(runFullFlow(approvedRepository())).rejects.toThrow(
      /challenge changed after approval/,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(refreshedResponse.bodyUsed).toBe(true);
  });

  it('rejects a changed challenge when continuing an approved spend request', async () => {
    const repository = {
      retrieve: vi.fn().mockResolvedValue({
        id: 'lsrq_123',
        status: 'approved',
        credential_type: 'shared_payment_token',
        shared_payment_token: { id: 'spt_test_123' },
      }),
    } as unknown as ISpendRequestResource;
    const refreshedResponse = challengeResponse(
      challengeWith({ request: { ...STRIPE_REQUEST, amount: '2000' } }),
    );
    const fetcher = vi.fn().mockResolvedValueOnce(refreshedResponse);
    vi.stubGlobal('fetch', fetcher);

    await expect(
      runMppPayWithSpendRequest(
        'https://merchant.example/challenge',
        'lsrq_123',
        'GET',
        undefined,
        undefined,
        repository,
        WWW_AUTHENTICATE_STRIPE,
      ),
    ).rejects.toThrow(/challenge changed after approval/);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      new Headers(fetcher.mock.calls[0][1]?.headers).has('authorization'),
    ).toBe(false);
    expect(refreshedResponse.bodyUsed).toBe(true);
  });

  it('rejects an explicit amount that conflicts with the challenge', async () => {
    const repository = approvedRepository();
    const fetcher = vi.fn().mockResolvedValueOnce(challengeResponse());
    vi.stubGlobal('fetch', fetcher);

    await expect(runFullFlow(repository, 2000)).rejects.toThrow(
      '--amount must match the MPP challenge amount (1000)',
    );
    expect(repository.create).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no authentication challenge', undefined],
    ['a non-Payment challenge', 'Basic realm="merchant.example"'],
    ['a malformed Payment challenge', 'Payment id="ch_002"'],
  ])(
    'rejects a refreshed 402 with %s without submitting a credential',
    async (_case, authenticate) => {
      const refreshedResponse = new Response('payment required', {
        status: 402,
        headers: authenticate
          ? { 'www-authenticate': authenticate }
          : undefined,
      });
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(challengeResponse())
        .mockResolvedValueOnce(refreshedResponse);
      vi.stubGlobal('fetch', fetcher);

      await expect(runFullFlow(approvedRepository())).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(refreshedResponse.bodyUsed).toBe(true);
    },
  );
});

function approvedRepository() {
  return {
    create: vi.fn().mockResolvedValue({
      id: 'lsrq_123',
      status: 'pending_approval',
    }),
    retrieve: vi
      .fn()
      .mockResolvedValueOnce({ id: 'lsrq_123', status: 'approved' })
      .mockResolvedValueOnce({
        id: 'lsrq_123',
        status: 'approved',
        shared_payment_token: { id: 'spt_test_123' },
      }),
  } as unknown as ISpendRequestResource;
}

function runFullFlow(
  repository: ISpendRequestResource,
  amountOverride = 1000,
  aapCredentialProvider?: AapCredentialProvider,
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
    repository,
    paymentMethodsFactory: vi.fn(),
    aapCredentialProvider,
  });
}
