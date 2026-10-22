import {
  LinkApiError,
  type LinkOptions,
  LinkResponseError,
  LinkTransportError,
} from '@stripe/link-sdk';
import { z } from 'zod';

const decisionResponseSchema = z.looseObject({
  id: z.string(),
  status: z.string(),
});

function extractErrorMessage(data: unknown, rawBody: string): string {
  if (data !== null && typeof data === 'object') {
    const error = 'error' in data ? data.error : undefined;
    if (typeof error === 'string') return error;
    if (error !== null && typeof error === 'object') {
      if ('message' in error && typeof error.message === 'string') {
        return error.message;
      }
      if ('code' in error && typeof error.code === 'string') {
        return error.code;
      }
    }
    if ('message' in data && typeof data.message === 'string') {
      return data.message;
    }
  }
  return rawBody || 'unknown error';
}

export class TestHelpersSpendRequestResource {
  constructor(private readonly options: LinkOptions) {}

  async approve(id: string): Promise<{ id: string; status: string }> {
    const { options } = this;
    const baseUrl =
      options.spendRequestBaseUrl ??
      options.apiBaseUrl ??
      'https://api.link.com';
    const url = `${baseUrl}/test_helpers/spend_requests/${encodeURIComponent(id)}/approve`;
    const request = async (token: string) => {
      if (options.verbose) options.logger?.debug(`> POST ${url}`);
      let response: Response;
      try {
        const headers = new Headers(options.defaultHeaders);
        headers.set('Authorization', `Bearer ${token}`);
        response = await (options.fetch ?? globalThis.fetch)(url, {
          method: 'POST',
          headers,
        });
      } catch (error) {
        throw new LinkTransportError(`Request failed: POST ${url}`, {
          cause: error,
        });
      }
      const rawBody = await response.text();
      let data: unknown = null;
      try {
        data = JSON.parse(rawBody);
      } catch {
        // Non-JSON response (e.g., from a load balancer).
      }
      if (options.verbose) {
        options.logger?.debug(`< ${response.status} ${response.statusText}`);
      }
      return { status: response.status, data, rawBody };
    };

    const token = options.getAccessToken
      ? await options.getAccessToken()
      : options.accessToken;
    let result = await request(token);
    if (result.status === 401 && options.getAccessToken) {
      result = await request(
        await options.getAccessToken({ forceRefresh: true }),
      );
    }
    const { status, data, rawBody } = result;
    if (status < 200 || status >= 300) {
      throw new LinkApiError(
        `Failed to approve test request (${status}): ${extractErrorMessage(data, rawBody)}`,
        { status, rawBody, details: data },
      );
    }
    const parsed = decisionResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new LinkResponseError('approve test request', status, {
        cause: parsed.error,
      });
    }
    return parsed.data;
  }
}
