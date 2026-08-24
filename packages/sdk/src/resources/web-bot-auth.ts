import type { LinkOptions } from '@/config';
import { LinkSdkError } from '@/errors';
import { BaseResource, requireRecord, requireString } from '@/resources/base';
import type { IWebBotAuthResource } from '@/resources/interfaces';
import type { WebBotAuthBlock } from '@/types/index';

interface CacheEntry {
  block: WebBotAuthBlock;
  expiresAt: number;
}

const EXPIRY_BUFFER_MS = 30_000;

function parseWebBotAuthBlock(value: unknown): WebBotAuthBlock {
  const body = requireRecord(value);
  return {
    signature: requireString(body.signature, 'web_bot_auth.signature'),
    signature_input: requireString(
      body.signature_input,
      'web_bot_auth.signature_input',
    ),
    signature_agent: requireString(
      body.signature_agent,
      'web_bot_auth.signature_agent',
    ),
    authority: requireString(body.authority, 'web_bot_auth.authority'),
    expires_at: requireString(body.expires_at, 'web_bot_auth.expires_at'),
  };
}

export class WebBotAuthResource
  extends BaseResource
  implements IWebBotAuthResource
{
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: LinkOptions) {
    super(options, '/web_bot_auth/sign');
  }

  async signUrl(url: string): Promise<WebBotAuthBlock> {
    let authority: string;
    try {
      authority = new URL(url).hostname;
    } catch (error) {
      throw new LinkSdkError(`Invalid URL: ${url}`, { cause: error });
    }

    const cached = this.cache.get(authority);
    if (cached && Date.now() < cached.expiresAt - EXPIRY_BUFFER_MS) {
      return cached.block;
    }

    const { status, data, rawBody } = await this.apiFetch({
      method: 'POST',
      url: this.endpoint,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    if (status < 200 || status >= 300) {
      this.throwApiError('get web bot auth headers', status, data, rawBody);
    }

    const webBotAuth = this.parseResponse(
      'get web bot auth headers',
      status,
      () => {
        const body = requireRecord(data);
        return parseWebBotAuthBlock(body.web_bot_auth);
      },
    );
    const expiresAt = Date.parse(webBotAuth.expires_at);
    if (Number.isNaN(expiresAt)) {
      throw new LinkSdkError(
        `Credentials response has invalid expires_at: ${webBotAuth.expires_at}`,
      );
    }

    this.cache.set(authority, { block: webBotAuth, expiresAt });
    return webBotAuth;
  }
}
