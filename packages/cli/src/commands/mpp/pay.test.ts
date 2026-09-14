import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertTempoCompatibleOptions,
  buildSignedTransactionCredential,
  payWithSignedTransaction,
  resolveTempoChallenge,
  runMppPayFullFlow,
} from './pay';

const TOKEN = '0x20C000000000000000000000b9537d11c60E8b50';
const RECIPIENT = '0x7b9cae3c6f339d864c7c4ceeec9703c864a68c9b';
const SIGNED_TRANSACTION = '0x76aabbcc';
const SPONSORED_TRANSACTION = '0x78aabbcc';

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

afterEach(() => {
  vi.unstubAllGlobals();
});

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

function signedSpendRequest() {
  return {
    id: 'lsrq_signed_001',
    status: 'approved',
    credential_type: 'signed_transaction',
    payment_challenge: tempoChallenge(),
    signed_transaction: { tx_hash: SIGNED_TRANSACTION },
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
    signed_transaction: { tx_hash: SPONSORED_TRANSACTION },
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
      payment_challenge: tempoChallenge(),
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
