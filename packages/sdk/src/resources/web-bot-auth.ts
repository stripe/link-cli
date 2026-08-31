import type { LinkOptions } from '@/config';
import { LinkSdkError } from '@/errors';
import { BaseResource } from '@/resources/base';
import type { IWebBotAuthResource } from '@/resources/interfaces';
import type { WebBotAuthBlock } from '@/types/index';
import { z } from 'zod';

interface CacheEntry {
  block: WebBotAuthBlock;
  expiresAt: number;
}

const EXPIRY_BUFFER_MS = 30_000;

const webBotAuthBlockSchema = z.looseObject({
  signature: z.string(),
  signature_input: z.string(),
  signature_agent: z.string(),
  authority: z.string(),
  expires_at: z.string(),
});
const webBotAuthResponseSchema = z.looseObject({
  web_bot_auth: webBotAuthBlockSchema,
});

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
      () => webBotAuthResponseSchema.parse(data).web_bot_auth,
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
