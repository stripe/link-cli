import type { IReportResource } from '@stripe/link-sdk';
import { Cli } from 'incur';
import type { CliAuthStorage } from '../../auth/storage';
import { requireAuthGuard } from '../../utils/require-auth';
import { reportOptions } from './schema';

export function createReportCli(
  createResource: () => IReportResource,
  authStorage?: CliAuthStorage,
  envAccessToken?: string,
) {
  const cli = Cli.create('report', {
    description:
      'Report the outcome of an agent action on a domain. Call after every purchase attempt.',
    options: reportOptions,
    outputPolicy: 'agent-only' as const,
    async run(c) {
      requireAuthGuard(c, authStorage, envAccessToken);
      const resource = createResource();
      const result = await resource.create({
        domain: c.options.domain,
        outcome: c.options.outcome,
        spend_request_id: c.options.spendRequestId,
        tags: c.options.tag,
        step: c.options.step,
        freeform_context: c.options.freeformContext,
      });
      return result;
    },
  });

  return cli;
}
