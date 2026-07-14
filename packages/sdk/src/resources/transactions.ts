import type { LinkOptions } from '@/config';
import { LinkApiError } from '@/errors';
import { BaseResource, isRecord, requireBoolean } from '@/resources/base';
import type {
  ITransactionsResource,
  ListTransactionsParams,
} from '@/resources/interfaces';
import type {
  Transaction,
  TransactionOrigin,
  TransactionsPage,
} from '@/types/index';

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`Expected ${field} to be a string`);
  }
  return value;
}

function requireNullableString(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new TypeError(`Expected ${field} to be a string or null`);
  }
  return value;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Expected ${field} to be a finite number`);
  }
  return value;
}

function requireTransactionOrigin(
  value: unknown,
  field: string,
): TransactionOrigin {
  if (value === 'link' || value === 'external_connection') {
    return value;
  }
  throw new TypeError(`Expected ${field} to be a transaction origin`);
}

function normalizeTransactions(value: unknown): Transaction[] {
  if (!Array.isArray(value)) {
    throw new TypeError('Expected transactions to be an array');
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new TypeError(`Expected transactions[${index}] to be an object`);
    }

    return {
      id: requireString(item.id, `transactions[${index}].id`),
      source_id: requireNullableString(
        item.source_id,
        `transactions[${index}].source_id`,
      ),
      amount: requireNumber(item.amount, `transactions[${index}].amount`),
      currency: requireString(item.currency, `transactions[${index}].currency`),
      created_date: requireString(
        item.created_date,
        `transactions[${index}].created_date`,
      ),
      description: requireString(
        item.description,
        `transactions[${index}].description`,
      ),
      origin: requireTransactionOrigin(
        item.origin,
        `transactions[${index}].origin`,
      ),
      category: requireNullableString(
        item.category,
        `transactions[${index}].category`,
      ),
      status: requireString(item.status, `transactions[${index}].status`),
    };
  });
}

function normalizeTransactionsPage(value: unknown): TransactionsPage {
  if (Array.isArray(value)) {
    return { data: normalizeTransactions(value) };
  }

  if (!isRecord(value)) {
    throw new TypeError('Expected response body to be an object');
  }

  const { data, has_more, ...rest } = value;
  const normalized = normalizeTransactions(data);

  return {
    ...rest,
    data: normalized,
    ...(has_more !== undefined
      ? { has_more: requireBoolean(has_more, 'has_more') }
      : {}),
  };
}

export class TransactionsResource
  extends BaseResource
  implements ITransactionsResource
{
  constructor(options: LinkOptions = {}) {
    super(options, '/transactions');
  }

  private buildUrl(params: ListTransactionsParams): string {
    const url = new URL(this.endpoint);

    if (params.limit !== undefined) {
      url.searchParams.set('limit', String(params.limit));
    }
    if (params.starting_after !== undefined) {
      url.searchParams.set('starting_after', params.starting_after);
    }
    if (params.ending_before !== undefined) {
      url.searchParams.set('ending_before', params.ending_before);
    }
    if (params.start_date !== undefined) {
      url.searchParams.set('date_start', params.start_date);
    }
    if (params.end_date !== undefined) {
      url.searchParams.set('date_end', params.end_date);
    }
    if (params.category !== undefined) {
      url.searchParams.set('category', params.category);
    }
    if (params.origin !== undefined) {
      url.searchParams.set('origin', params.origin);
    }
    if (params.sources !== undefined) {
      for (const source of params.sources) {
        url.searchParams.append('sources[]', source);
      }
    }

    return url.toString();
  }

  list(params: ListTransactionsParams = {}): Promise<TransactionsPage> {
    return this.listTransactions(params);
  }

  async listTransactions(
    params: ListTransactionsParams = {},
  ): Promise<TransactionsPage> {
    const { status, data, rawBody } = await this.apiFetch({
      method: 'GET',
      url: this.buildUrl(params),
    });

    if (status < 200 || status >= 300) {
      this.throwApiError('list transactions', status, data, rawBody);
    }

    try {
      return normalizeTransactionsPage(data);
    } catch (error) {
      const reason = error instanceof Error ? `: ${error.message}` : '';
      throw new LinkApiError(
        `Failed to list transactions (${status}): invalid response shape${reason}`,
        { status, rawBody, details: data, cause: error },
      );
    }
  }
}
