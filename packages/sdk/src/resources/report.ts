import type { LinkOptions } from '@/config';
import { BaseResource } from '@/resources/base';
import type {
  CreateReportParams,
  IReportResource,
  ReportRecord,
} from '@/resources/interfaces';
import { z } from 'zod';

const reportRecordSchema = z.looseObject({
  object: z.string(),
  created_at: z.string(),
  domain: z.string(),
  outcome: z.string(),
  spend_request_id: z.string(),
  status: z.string(),
});

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
      reportRecordSchema.parse(data),
    );
  }
}
