import type { LinkOptions } from '@/config';
import { BaseResource, requireRecord, requireString } from '@/resources/base';
import type {
  CreateReportParams,
  IReportResource,
  ReportRecord,
} from '@/resources/interfaces';

function parseReportRecord(value: unknown): ReportRecord {
  const body = requireRecord(value);
  return {
    object: requireString(body.object, 'object'),
    created_at: requireString(body.created_at, 'created_at'),
    domain: requireString(body.domain, 'domain'),
    outcome: requireString(body.outcome, 'outcome'),
    spend_request_id: requireString(body.spend_request_id, 'spend_request_id'),
    status: requireString(body.status, 'status'),
  };
}

export class ReportResource extends BaseResource implements IReportResource {
  constructor(options: LinkOptions) {
    super(options, '/agent_observations');
  }

  async create(params: CreateReportParams): Promise<ReportRecord> {
    const { status, data, rawBody } = await this.apiFetch({
      method: 'POST',
      url: this.endpoint,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (status < 200 || status >= 300) {
      this.throwApiError('create report', status, data, rawBody);
    }

    return this.parseResponse('create report', status, () =>
      parseReportRecord(data),
    );
  }
}
