import type { LinkOptions } from '@/config';
import { LinkApiError } from '@/errors';
import { BaseResource, isRecord, requireBoolean } from '@/resources/base';
import type {
  IBalancesResource,
  ListBalancesParams,
} from '@/resources/interfaces';
import type { Balance, BalancesPage } from '@/types/index';

function normalizeBalances(value: unknown): Balance[] {
  if (!Array.isArray(value)) {
    throw new TypeError('Expected balances to be an array');
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new TypeError(`Expected balances[${index}] to be an object`);
    }
    return item as Balance;
  });
}

function normalizeBalancesPage(value: unknown): BalancesPage {
  if (!isRecord(value)) {
    throw new TypeError('Expected response body to be an object');
  }

  const { data, has_more, ...rest } = value;
  const normalized = normalizeBalances(data);

  return {
    ...rest,
    data: normalized,
    ...(has_more !== undefined
      ? { has_more: requireBoolean(has_more, 'has_more') }
      : {}),
  };
}

export class BalancesResource
  extends BaseResource
  implements IBalancesResource
{
  constructor(options: LinkOptions = {}) {
    super(options, '/balances');
  }

  private buildUrl(params: ListBalancesParams): string {
    const url = new URL(this.endpoint);

    if (params.sources !== undefined) {
      for (const source of params.sources) {
        url.searchParams.append('sources[]', source);
      }
    }
    if (params.limit !== undefined) {
      url.searchParams.set('limit', String(params.limit));
    }
    if (params.starting_after !== undefined) {
      url.searchParams.set('starting_after', params.starting_after);
    }
    if (params.ending_before !== undefined) {
      url.searchParams.set('ending_before', params.ending_before);
    }

    return url.toString();
  }

  list(params: ListBalancesParams = {}): Promise<BalancesPage> {
    return this.listBalances(params);
  }

  async listBalances(params: ListBalancesParams = {}): Promise<BalancesPage> {
    const { status, data, rawBody } = await this.apiFetch({
      method: 'GET',
      url: this.buildUrl(params),
    });

    if (status < 200 || status >= 300) {
      this.throwApiError('list balances', status, data, rawBody);
    }

    try {
      return normalizeBalancesPage(data);
    } catch (error) {
      const reason = error instanceof Error ? `: ${error.message}` : '';
      throw new LinkApiError(
        `Failed to list balances (${status}): invalid response shape${reason}`,
        { status, rawBody, details: data, cause: error },
      );
    }
  }
}
