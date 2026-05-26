import { LinkApiError, LinkSdkError } from '@/errors';
import { WebBotAuthResource } from '@/resources/web-bot-auth';
import type { WebBotAuthBlock } from '@/types/index';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn();
const getAccessToken = vi.fn();

function mockFetchResponse(status: number, body: Record<string, unknown>) {
  mockFetch.mockResolvedValue({
    status,
    text: async () => JSON.stringify(body),
  });
}

const validUrl = 'https://wine-merchant.com/products';

const webBotAuthBlock: WebBotAuthBlock = {
  signature: 'sig1=:stub_sig:',
  signature_input:
    'sig1=("@authority" "signature-agent");created=1715400000;keyid="stub_keyid";alg="ed25519";expires=1715400600;tag="web-bot-auth"',
  signature_agent:
    'https://api.link.com/.well-known/http-message-signatures-directory',
  authority: 'wine-merchant.com',
  expires_at: '2099-12-31T23:59:59Z',
};

const credentialsResponse = {
  identity_token: 'tok_test123',
  web_bot_auth: webBotAuthBlock,
};

describe('WebBotAuthResource', () => {
  let resource: WebBotAuthResource;

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.clearAllMocks();
    getAccessToken.mockResolvedValue('test_token');
    resource = new WebBotAuthResource({ getAccessToken });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getHeaders', () => {
    it('sends POST to credentials endpoint with JSON body and Bearer auth', async () => {
      mockFetchResponse(200, credentialsResponse);

      await resource.getHeaders(validUrl);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.link.com/v1/agent_identity/credentials');
      expect(opts.method).toBe('POST');
      expect(opts.headers['Content-Type']).toBe('application/json');
      expect(opts.headers.Authorization).toBe('Bearer test_token');
      expect(JSON.parse(opts.body)).toEqual({ url: validUrl });
    });

    it('returns the web_bot_auth block on success', async () => {
      mockFetchResponse(200, credentialsResponse);

      const result = await resource.getHeaders(validUrl);

      expect(result).toEqual(webBotAuthBlock);
    });

    it('caches result per authority and skips re-fetch for same hostname', async () => {
      mockFetchResponse(200, credentialsResponse);

      const first = await resource.getHeaders(validUrl);
      const second = await resource.getHeaders(
        'https://wine-merchant.com/other-page',
      );

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(second).toEqual(first);
    });

    it('does not share cache across different authorities', async () => {
      mockFetchResponse(200, credentialsResponse);
      await resource.getHeaders(validUrl);

      mockFetchResponse(200, credentialsResponse);
      await resource.getHeaders('https://other-merchant.com/page');

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('re-fetches when cached entry expires within the 30s buffer', async () => {
      const nearlyExpiredBlock: WebBotAuthBlock = {
        ...webBotAuthBlock,
        expires_at: new Date(Date.now() + 20_000).toISOString(),
      };
      mockFetchResponse(200, {
        ...credentialsResponse,
        web_bot_auth: nearlyExpiredBlock,
      });

      await resource.getHeaders(validUrl);

      mockFetchResponse(200, credentialsResponse);
      await resource.getHeaders(validUrl);

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('does not re-fetch when cached entry is still fresh', async () => {
      mockFetchResponse(200, credentialsResponse);

      await resource.getHeaders(validUrl);
      await resource.getHeaders(validUrl);

      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('retries with refreshed token on 401', async () => {
      mockFetch
        .mockResolvedValueOnce({ status: 401, text: async () => '{}' })
        .mockResolvedValueOnce({
          status: 200,
          text: async () => JSON.stringify(credentialsResponse),
        });
      getAccessToken
        .mockResolvedValueOnce('expired_token')
        .mockResolvedValueOnce('fresh_token');

      const result = await resource.getHeaders(validUrl);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const [, secondOpts] = mockFetch.mock.calls[1];
      expect(secondOpts.headers.Authorization).toBe('Bearer fresh_token');
      expect(result).toEqual(webBotAuthBlock);
    });

    it('throws LinkApiError on HTTP error', async () => {
      mockFetchResponse(422, { error: 'Invalid URL' });

      const err = await resource.getHeaders(validUrl).catch((e) => e);
      expect(err).toBeInstanceOf(LinkApiError);
      expect(err.message).toMatch('Failed to get web bot auth headers (422)');
    });

    it('throws LinkSdkError when expires_at is malformed', async () => {
      mockFetchResponse(200, {
        ...credentialsResponse,
        web_bot_auth: { ...webBotAuthBlock, expires_at: 'not-a-date' },
      });

      const err = await resource.getHeaders(validUrl).catch((e) => e);
      expect(err).toBeInstanceOf(LinkSdkError);
      expect(err.message).toMatch('invalid expires_at');
    });

    it('throws LinkSdkError when response is missing web_bot_auth block', async () => {
      mockFetchResponse(200, { identity_token: 'tok_test123' });

      const err = await resource.getHeaders(validUrl).catch((e) => e);
      expect(err).toBeInstanceOf(LinkSdkError);
      expect(err.message).toMatch(
        'Credentials response missing web_bot_auth block',
      );
    });

    it('throws when access token is unavailable', async () => {
      getAccessToken.mockRejectedValueOnce(new Error('Missing access token'));

      await expect(resource.getHeaders(validUrl)).rejects.toThrow(
        'Missing access token',
      );
    });

    it('throws LinkSdkError on invalid URL', async () => {
      const err = await resource.getHeaders('not-a-url').catch((e) => e);
      expect(err).toBeInstanceOf(LinkSdkError);
      expect(err.message).toMatch('Invalid URL');
    });
  });
});
