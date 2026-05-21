import type {
  ISpendRequestResource,
  IWebBotAuthResource,
  WebBotAuthBlock,
} from '@stripe/link-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMppPay } from '../pay';

const SPEND_REQUEST = {
  id: 'sr_123',
  status: 'approved',
  credential_type: 'shared_payment_token',
  shared_payment_token: { id: 'spt_abc' },
};

const WWW_AUTHENTICATE_STRIPE = [
  'Payment id="ch_001",',
  'realm="127.0.0.1",',
  'method="stripe",',
  'intent="charge",',
  `request="${Buffer.from(JSON.stringify({ networkId: 'net_001', amount: '1000', currency: 'usd', decimals: 2, paymentMethodTypes: ['card'] })).toString('base64')}",`,
  'expires="2099-01-01T00:00:00Z"',
].join(' ');

const WEB_BOT_AUTH_BLOCK: WebBotAuthBlock = {
  signature: 'sig1=:stub_sig:',
  signature_input:
    'sig1=("@authority" "signature-agent");created=1;keyid="k";alg="ed25519";expires=2;tag="web-bot-auth"',
  signature_agent:
    'https://api.link.com/.well-known/http-message-signatures-directory',
  authority: 'wine-merchant.com',
  expires_at: '2099-12-31T23:59:59Z',
};

function makeRepository(sr = SPEND_REQUEST): ISpendRequestResource {
  return {
    getSpendRequest: vi.fn(async () => sr),
  } as unknown as ISpendRequestResource;
}

function makeWebBotAuth(block = WEB_BOT_AUTH_BLOCK): IWebBotAuthResource {
  return {
    getHeaders: vi.fn(async () => block),
  } as unknown as IWebBotAuthResource;
}

describe('runMppPay', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns result directly when merchant responds 200', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const webBotAuth = makeWebBotAuth();
    const result = await runMppPay(
      'https://merchant.com/checkout',
      'sr_123',
      undefined,
      undefined,
      undefined,
      makeRepository(),
      webBotAuth,
    );

    expect(result.status).toBe(200);
    expect(result.body).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(webBotAuth.getHeaders).not.toHaveBeenCalled();
  });

  it('does not call webBotAuth for non-403 error responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('not found', { status: 404 })),
    );

    const webBotAuth = makeWebBotAuth();
    const result = await runMppPay(
      'https://merchant.com/checkout',
      'sr_123',
      undefined,
      undefined,
      undefined,
      makeRepository(),
      webBotAuth,
    );

    expect(result.status).toBe(404);
    expect(webBotAuth.getHeaders).not.toHaveBeenCalled();
  });

  it('retries with Signature headers when merchant returns 403', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('bot blocked', { status: 403 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const webBotAuth = makeWebBotAuth();
    const result = await runMppPay(
      'https://merchant.com/checkout',
      'sr_123',
      undefined,
      undefined,
      undefined,
      makeRepository(),
      webBotAuth,
    );

    expect(result.status).toBe(200);
    expect(webBotAuth.getHeaders).toHaveBeenCalledWith(
      'https://merchant.com/checkout',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [, retryInit] = fetchMock.mock.calls[1] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(retryInit.headers.Signature).toBe(WEB_BOT_AUTH_BLOCK.signature);
    expect(retryInit.headers['Signature-Input']).toBe(
      WEB_BOT_AUTH_BLOCK.signature_input,
    );
  });

  it('handles full 403→402→SPT flow: bot auth headers carry through to the SPT retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('bot blocked', { status: 403 }))
      .mockResolvedValueOnce(
        new Response('payment required', {
          status: 402,
          headers: { 'www-authenticate': WWW_AUTHENTICATE_STRIPE },
        }),
      )
      .mockResolvedValueOnce(new Response('payment accepted', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const webBotAuth = makeWebBotAuth();
    const result = await runMppPay(
      'https://merchant.com/checkout',
      'sr_123',
      undefined,
      undefined,
      undefined,
      makeRepository(),
      webBotAuth,
    );

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(webBotAuth.getHeaders).toHaveBeenCalledWith(
      'https://merchant.com/checkout',
    );

    // Second call (bot auth retry) must have Signature headers
    const [, botAuthInit] = fetchMock.mock.calls[1] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(botAuthInit.headers.Signature).toBe(WEB_BOT_AUTH_BLOCK.signature);
    expect(botAuthInit.headers['Signature-Input']).toBe(
      WEB_BOT_AUTH_BLOCK.signature_input,
    );

    // Third call (SPT retry) must carry BOTH bot auth headers AND Authorization: Payment
    const [, sptInit] = fetchMock.mock.calls[2] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(sptInit.headers.Signature).toBe(WEB_BOT_AUTH_BLOCK.signature);
    expect(sptInit.headers['Signature-Input']).toBe(
      WEB_BOT_AUTH_BLOCK.signature_input,
    );
    expect(sptInit.headers.Authorization).toMatch(/^Payment /);
  });

  it('propagates error when webBotAuth.getHeaders throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('bot blocked', { status: 403 })),
    );

    const webBotAuth = {
      getHeaders: vi.fn(async () => {
        throw new Error('Not authenticated');
      }),
    } as unknown as IWebBotAuthResource;

    await expect(
      runMppPay(
        'https://merchant.com/checkout',
        'sr_123',
        undefined,
        undefined,
        undefined,
        makeRepository(),
        webBotAuth,
      ),
    ).rejects.toThrow('Not authenticated');
  });

  it('throws when spend request is not found', async () => {
    const repository = {
      getSpendRequest: vi.fn(async () => null),
    } as unknown as ISpendRequestResource;

    await expect(
      runMppPay(
        'https://merchant.com/checkout',
        'sr_missing',
        undefined,
        undefined,
        undefined,
        repository,
        makeWebBotAuth(),
      ),
    ).rejects.toThrow('sr_missing not found');
  });

  it('throws when spend request is not approved', async () => {
    const repository = makeRepository({
      ...SPEND_REQUEST,
      status: 'pending',
    });

    await expect(
      runMppPay(
        'https://merchant.com/checkout',
        'sr_123',
        undefined,
        undefined,
        undefined,
        repository,
        makeWebBotAuth(),
      ),
    ).rejects.toThrow('approved');
  });
});
