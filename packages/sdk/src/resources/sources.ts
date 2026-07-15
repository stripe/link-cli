import type { LinkOptions } from '@/config';
import { LinkApiError } from '@/errors';
import { BaseResource, isRecord, requireBoolean } from '@/resources/base';
import type {
  ISourcesResource,
  ListSourcesParams,
} from '@/resources/interfaces';
import type { Source, SourcesPage } from '@/types/index';

function normalizeSources(value: unknown): Source[] {
  if (!Array.isArray(value)) {
    throw new TypeError('Expected sources to be an array');
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new TypeError(`Expected sources[${index}] to be an object`);
    }
    return item as Source;
  });
}

function normalizeSourcesPage(value: unknown): SourcesPage {
  if (!isRecord(value)) {
    throw new TypeError('Expected response body to be an object');
  }

  const { data, has_more, ...rest } = value;
  const normalized = normalizeSources(data);

  return {
    ...rest,
    data: normalized,
    ...(has_more !== undefined
      ? { has_more: requireBoolean(has_more, 'has_more') }
      : {}),
  };
}

export class SourcesResource extends BaseResource implements ISourcesResource {
  constructor(options: LinkOptions = {}) {
    super(options, '/sources');
  }

  private buildUrl(params: ListSourcesParams): string {
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

    return url.toString();
  }

  list(params: ListSourcesParams = {}): Promise<SourcesPage> {
    return this.listSources(params);
  }

  async listSources(params: ListSourcesParams = {}): Promise<SourcesPage> {
    const { status, data, rawBody } = await this.apiFetch({
      method: 'GET',
      url: this.buildUrl(params),
    });

    if (status < 200 || status >= 300) {
      this.throwApiError('list sources', status, data, rawBody);
    }

    try {
      return normalizeSourcesPage(data);
    } catch (error) {
      const reason = error instanceof Error ? `: ${error.message}` : '';
      throw new LinkApiError(
        `Failed to list sources (${status}): invalid response shape${reason}`,
        { status, rawBody, details: data, cause: error },
      );
    }
  }
}
