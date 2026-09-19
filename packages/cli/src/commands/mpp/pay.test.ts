import type { ISpendRequestResource } from '@stripe/link-sdk';
import { Challenge, Credential } from 'mppx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertTempoCompatibleOptions,
  buildSignedTransactionCredential,
  getExperimentalPaymentAuthorization,
  type IMppProofSigner,
  isTempoProofChallenge,
  payWithSignedTransaction,
  payWithSpt,
  resolveTempoChallenge,
  resolveTempoSessionChallenge,
  runMppPayFullFlow,
  runMppPayWithSpendRequest,
  runMppProof,
} from './pay';

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

const TOKEN = '0x20C000000000000000000000b9537d11c60E8b50';
const RECIPIENT = '0x7b9cae3c6f339d864c7c4ceeec9703c864a68c9b';
const SIGNED_TRANSACTION = '0x76aabbcc';
const SPONSORED_TRANSACTION = '0x78aabbcc';
const TEMPO_SOURCE =
  'did:pkh:eip155:4217:0xa2128C4C18e47778AE9Fa98E10cf76304f228e7c';
const PROOF_SIGNATURE = `0x${'11'.repeat(65)}`;

function proofSigner() {
  return {
    signMppProof: vi.fn(async () => ({
      signature: PROOF_SIGNATURE,
      source: TEMPO_SOURCE,
    })),
  } satisfies IMppProofSigner;
}

function tempoChallenge(
  overrides: Record<string, unknown> = {},
  intent = 'charge',
) {
  const request = {
    amount: '10000',
    currency: TOKEN,
    recipient: RECIPIENT,
    methodDetails: {
      chainId: 4217,
      supportedModes: ['pull'],
    },
    ...overrides,
  };
  return [
    'Payment id="tempo_001",',
    'realm="merchant.example",',
    'method="tempo",',
    `intent="${intent}",`,
    `request="${Buffer.from(JSON.stringify(request)).toString('base64url')}",`,
    'expires="2099-01-01T00:00:00Z"',
  ].join(' ');
}

beforeEach(() => {
  vi.stubGlobal('__CLI_VERSION__', 'test');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('payWithSpt', () => {
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

function runFullFlow(repository: ISpendRequestResource, amountOverride = 1000) {
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
  });
}
describe('resolveTempoChallenge', () => {
  it('normalizes a supported Tempo pull charge', () => {
    const resolved = resolveTempoChallenge(tempoChallenge());

    expect(resolved.challenge.id).toBe('tempo_001');
    expect(resolved.request).toMatchObject({
      amount: '10000',
      currency: TOKEN,
      decimals: 6,
      chainId: 4217,
      recipient: RECIPIENT,
      supportedModes: ['pull'],
    });
  });

  it('normalizes a sponsored Tempo pull charge', () => {
    const resolved = resolveTempoChallenge(
      tempoChallenge({
        methodDetails: {
          chainId: 4217,
          feePayer: true,
          supportedModes: ['pull'],
        },
      }),
    );

    expect(resolved.request.feePayer).toBe(true);
  });

  it('recognizes a zero-dollar proof without transaction-only fields', () => {
    const resolved = resolveTempoChallenge(
      tempoChallenge({
        amount: '0',
        recipient: undefined,
        methodDetails: { chainId: 4217, supportedModes: ['push'] },
      }),
    );

    expect(isTempoProofChallenge(resolved)).toBe(true);
    expect(resolved.request.recipient).toBeUndefined();
  });

  it.each([
    [{ methodDetails: { chainId: 1, supportedModes: ['pull'] } }, /chain ID/i],
    [
      { methodDetails: { chainId: 4217, supportedModes: ['push'] } },
      /pull mode/i,
    ],
    [
      {
        methodDetails: {
          chainId: 4217,
          splits: [{ amount: '10000', recipient: RECIPIENT }],
        },
      },
      /split payments/i,
    ],
  ])('rejects unsupported charge features', (overrides, message) => {
    expect(() => resolveTempoChallenge(tempoChallenge(overrides))).toThrow(
      message,
    );
  });

  it('rejects Tempo sessions', () => {
    expect(() => resolveTempoChallenge(tempoChallenge({}, 'session'))).toThrow(
      /charge only/i,
    );
  });

  it('selects a Tempo session challenge when explicitly requested', () => {
    const charge = tempoChallenge();
    const session = tempoChallenge(
      {
        unitType: 'request',
        methodDetails: {
          chainId: 4217,
          escrowContract: '0x4d50500000000000000000000000000000000000',
          feePayer: true,
          sessionProtocol: 'v2',
        },
      },
      'session',
    ).replace('id="tempo_001"', 'id="session_001"');

    expect(
      resolveTempoSessionChallenge(`${charge}, ${session}`).challenge,
    ).toMatchObject({
      id: 'session_001',
      intent: 'session',
      method: 'tempo',
    });
  });

  it('rejects expired challenges', () => {
    expect(() =>
      resolveTempoChallenge(
        tempoChallenge().replace(
          '2099-01-01T00:00:00Z',
          '2020-01-01T00:00:00Z',
        ),
      ),
    ).toThrow(/expired/i);
  });
});

describe('zero-dollar MPP proof', () => {
  const zeroDollarChallenge = () =>
    tempoChallenge({
      amount: '0',
      recipient: undefined,
      methodDetails: { chainId: 4217, supportedModes: ['push'] },
    });

  it('signs and retries without exposing the proof credential', async () => {
    const signer = proofSigner();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('authentication required', {
          status: 402,
          headers: { 'www-authenticate': zeroDollarChallenge() },
        }),
      )
      .mockResolvedValueOnce(
        new Response('{"authenticated":true}', { status: 200 }),
      );

    const result = await runMppProof({
      url: 'https://merchant.example/jobs/123',
      method: 'GET',
      signer,
      fetcher,
    });

    expect(result).toMatchObject({
      status: 200,
      body: '{"authenticated":true}',
    });
    expect(signer.signMppProof).toHaveBeenCalledWith({
      challenge: expect.objectContaining({
        id: 'tempo_001',
        realm: 'merchant.example',
      }),
      chainId: 4217,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const authorization = new Headers(fetcher.mock.calls[1]?.[1]?.headers).get(
      'authorization',
    );
    expect(authorization).toMatch(/^Payment /);
    const credential = Credential.deserialize<{
      signature: string;
      type: string;
    }>(authorization as string);
    expect(credential.payload).toEqual({
      signature: PROOF_SIGNATURE,
      type: 'proof',
    });
    expect(credential.source).toBe(TEMPO_SOURCE);
  });

  it('rejects a non-zero challenge before asking the wallet to sign', async () => {
    const signer = proofSigner();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response('payment required', {
        status: 402,
        headers: { 'www-authenticate': tempoChallenge() },
      }),
    );

    await expect(
      runMppProof({
        url: 'https://merchant.example/paid',
        signer,
        fetcher,
      }),
    ).rejects.toThrow(/requires a zero-dollar Tempo charge challenge/i);
    expect(signer.signMppProof).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('uses the credential header selected by the proof challenge', async () => {
    const challenge = zeroDollarChallenge().replace(
      'intent="charge",',
      'intent="charge", header="Payment-Credential",',
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('authentication required', {
          status: 402,
          headers: { 'www-authenticate': challenge },
        }),
      )
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));

    await runMppProof({
      url: 'https://merchant.example/jobs/123',
      headers: ['Authorization: Bearer application-token'],
      signer: proofSigner(),
      fetcher,
    });

    const headers = new Headers(fetcher.mock.calls[1]?.[1]?.headers);
    expect(headers.get('payment-credential')).toMatch(/^Payment /);
    expect(headers.get('authorization')).toBe('Bearer application-token');
  });

  it('makes mpp pay bypass spend requests for a zero-dollar challenge', async () => {
    const signer = proofSigner();
    const repository = {
      create: vi.fn(),
      retrieve: vi.fn(),
    } as unknown as ISpendRequestResource;
    const paymentMethodsFactory = vi.fn();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('authentication required', {
          status: 402,
          headers: { 'www-authenticate': zeroDollarChallenge() },
        }),
      )
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetcher);

    const result = await runMppPayFullFlow({
      url: 'https://merchant.example/jobs/123',
      method: undefined,
      data: undefined,
      headers: undefined,
      context: undefined,
      amountOverride: undefined,
      paymentMethodId: undefined,
      test: false,
      repository,
      paymentMethodsFactory,
      proofSigner: signer,
    });

    expect(result.status).toBe(200);
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.retrieve).not.toHaveBeenCalled();
    expect(paymentMethodsFactory).not.toHaveBeenCalled();
    expect(signer.signMppProof).toHaveBeenCalledOnce();
  });

  it('refuses to follow a redirect after attaching a proof', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('authentication required', {
          status: 402,
          headers: { 'www-authenticate': zeroDollarChallenge() },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 307,
          headers: { location: 'https://other.example/jobs/123' },
        }),
      );

    await expect(
      runMppProof({
        url: 'https://merchant.example/jobs/123',
        signer: proofSigner(),
        fetcher,
      }),
    ).rejects.toThrow(/refusing to forward the proof credential/i);
    expect(fetcher.mock.calls[1]?.[1]?.redirect).toBe('manual');
  });
});

function signedSpendRequest() {
  return {
    id: 'lsrq_signed_001',
    status: 'approved',
    credential_type: 'signed_transaction',
    payment_challenge: tempoChallenge(),
    signed_transaction: { source: TEMPO_SOURCE, tx_hash: SIGNED_TRANSACTION },
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  } as const;
}

function sponsoredSpendRequest() {
  return {
    ...signedSpendRequest(),
    payment_challenge: tempoChallenge({
      methodDetails: {
        chainId: 4217,
        feePayer: true,
        supportedModes: ['pull'],
      },
    }),
    signed_transaction: {
      source: TEMPO_SOURCE,
      tx_hash: SPONSORED_TRANSACTION,
    },
  } as const;
}

describe('signed transaction payment', () => {
  it('builds the Tempo transaction credential returned by Link', () => {
    const credential = buildSignedTransactionCredential(signedSpendRequest());
    const encoded = credential.replace(/^Payment\s+/, '');
    const decoded = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    );

    expect(decoded.challenge.id).toBe('tempo_001');
    expect(decoded.source).toBe(TEMPO_SOURCE);
    expect(decoded.payload).toEqual({
      signature: SIGNED_TRANSACTION,
      type: 'transaction',
    });
  });

  it('builds a sponsored Tempo transaction credential returned by Link', () => {
    const credential = buildSignedTransactionCredential(
      sponsoredSpendRequest(),
    );
    const encoded = credential.replace(/^Payment\s+/, '');
    const decoded = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    );

    expect(decoded.payload).toEqual({
      signature: SPONSORED_TRANSACTION,
      type: 'transaction',
    });
  });

  it('submits an approved Link-signed transaction', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async (_input, _init) =>
        new Response('{"ok":true}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('__CLI_VERSION__', 'test');

    const result = await payWithSignedTransaction(
      'https://merchant.example/tool',
      signedSpendRequest(),
      'POST',
      '{"query":"hello"}',
      ['X-Test: yes'],
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: '{"query":"hello"}',
      headers: expect.objectContaining({
        Authorization: expect.stringMatching(/^Payment /),
        'X-Test': 'yes',
      }),
    });
    expect(result.status).toBe(200);
  });

  it('submits a complete session-open authorization returned by the PoC', async () => {
    const challengeHeader = tempoChallenge(
      {
        unitType: 'request',
        methodDetails: {
          chainId: 4217,
          escrowContract: '0x4d50500000000000000000000000000000000000',
          sessionProtocol: 'v2',
        },
      },
      'session',
    );
    const challenge = Challenge.deserialize(challengeHeader);
    const authorization = Credential.serialize({
      challenge,
      payload: {
        action: 'open',
        channelId: `0x${'11'.repeat(32)}`,
        cumulativeAmount: '10000',
        signature: `0x${'22'.repeat(65)}`,
        transaction: SIGNED_TRANSACTION,
        type: 'transaction',
      },
      source: TEMPO_SOURCE,
    });
    const spendRequest = {
      ...signedSpendRequest(),
      payment_challenge: challengeHeader,
      payment_authorization: {
        protocol: 'mpp' as const,
        header_name: 'Authorization',
        value: authorization,
      },
    };
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ jsonrpc: '2.0', id: 1, result: '0x1079' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    expect(getExperimentalPaymentAuthorization(spendRequest)).toBe(
      authorization,
    );
    await payWithSignedTransaction(
      'https://rpc.mpp.tempo.xyz/',
      spendRequest,
      'POST',
      '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}',
      undefined,
    );

    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: authorization,
    });
  });

  it('rejects a complete authorization for a different challenge', () => {
    const other = Challenge.deserialize(
      tempoChallenge().replace('id="tempo_001"', 'id="tempo_002"'),
    );
    const authorization = Credential.serialize({
      challenge: other,
      payload: { signature: SIGNED_TRANSACTION, type: 'transaction' },
    });

    expect(() =>
      getExperimentalPaymentAuthorization(
        {
          ...signedSpendRequest(),
          payment_authorization: {
            protocol: 'mpp',
            header_name: 'Authorization',
            value: authorization,
          },
        } as Parameters<typeof getExperimentalPaymentAuthorization>[0] & {
          payment_authorization: unknown;
        },
      ),
    ).toThrow(/does not match its original challenge/i);
  });

  it('creates, approves, retrieves, and submits through Link', async () => {
    const probe = new Response('payment required', {
      status: 402,
      headers: { 'www-authenticate': tempoChallenge() },
    });
    const paid = new Response('{"paid":true}', { status: 200 });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(probe)
      .mockResolvedValueOnce(paid);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('__CLI_VERSION__', 'test');

    const repository = {
      create: vi.fn(async () => ({
        ...signedSpendRequest(),
        status: 'pending_approval',
        signed_transaction: null,
        approval_url: 'https://link.com/approve/lsrq_signed_001',
      })),
      retrieve: vi
        .fn()
        .mockResolvedValueOnce(signedSpendRequest())
        .mockResolvedValueOnce(signedSpendRequest()),
    };
    const result = await runMppPayFullFlow({
      url: 'https://merchant.example/tool',
      method: undefined,
      data: undefined,
      headers: undefined,
      context:
        'Pay for one API request using a Link-approved signed Tempo transaction for this stablecoin proof of concept.',
      amountOverride: undefined,
      paymentMethodId: undefined,
      test: false,
      repository: repository as never,
      paymentMethodsFactory: () => {
        throw new Error('Link payment methods must not be loaded');
      },
    });

    expect(result.status).toBe(200);
    expect(repository.create).toHaveBeenCalledWith({
      credential_type: 'signed_transaction',
      payment_challenge: Challenge.serialize(
        Challenge.deserialize(tempoChallenge()),
      ),
      context:
        'Pay for one API request using a Link-approved signed Tempo transaction for this stablecoin proof of concept.',
      request_approval: true,
    });
    expect(repository.retrieve).toHaveBeenNthCalledWith(2, 'lsrq_signed_001', {
      include: ['signed_transaction'],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects missing or malformed signed transaction credentials', () => {
    expect(() =>
      buildSignedTransactionCredential({
        ...signedSpendRequest(),
        signed_transaction: null,
      }),
    ).toThrow(/does not have a signed transaction/i);
    expect(() =>
      buildSignedTransactionCredential({
        ...signedSpendRequest(),
        signed_transaction: { tx_hash: '0x1234' },
      }),
    ).toThrow(/0x76-prefixed/i);
    expect(() =>
      buildSignedTransactionCredential({
        ...sponsoredSpendRequest(),
        signed_transaction: { tx_hash: SIGNED_TRANSACTION },
      }),
    ).toThrow(/0x78-prefixed/i);
  });
});

describe('assertTempoCompatibleOptions', () => {
  it('rejects Stripe-specific payment options', () => {
    expect(() => assertTempoCompatibleOptions({ amountOverride: 10 })).toThrow(
      /--amount/,
    );
    expect(() =>
      assertTempoCompatibleOptions({ paymentMethodId: 'pd_123' }),
    ).toThrow(/--payment-method-id/);
    expect(() => assertTempoCompatibleOptions({ test: true })).toThrow(
      /--test/,
    );
  });
});
