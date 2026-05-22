import type { AuthStorage, IReportResource } from '@stripe/link-sdk';
import { Cli } from 'incur';
import { requireAuth } from '../../utils/require-auth';
import { reportOptions } from './schema';

export function createReportCli(
  createResource: () => IReportResource,
  authStorage?: AuthStorage,
) {
  const cli = Cli.create('report', {
    description: 'Report the outcome of a purchase attempt',
  });

  cli.command('', {
    description:
      'Report the outcome of an agent action on a domain. Call after every purchase attempt.',
    options: reportOptions,
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage)],
    async run(c) {
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
