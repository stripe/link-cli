import type {
  ITaxLotsResource,
  ListTaxLotsParams,
  TaxLotsPage,
} from '@stripe/link-sdk';
import { Cli } from 'incur';
import type { CliAuthStorage } from '../../auth/storage';
import { investmentApiError } from '../../utils/investment-api-error';
import { renderInteractive } from '../../utils/render-interactive';
import { requireAuth } from '../../utils/require-auth';
import { TaxLotsList } from './list';
import { listOptions } from './schema';

export function createTaxLotsCli(
  createResource: () => ITaxLotsResource,
  authStorage?: CliAuthStorage,
  envAccessToken?: string,
) {
  const cli = Cli.create('tax-lots', {
    description: '[beta] Read cached investment tax lots for a holding',
  });
  cli.command('list', {
    description:
      'List one page of read-only tax-lot snapshots; requires read_holdings access',
    options: listOptions,
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage, envAccessToken)],
    async run(c) {
      const opts = c.options;
      const params: ListTaxLotsParams = { holding: opts.holding };
      if (opts.limit !== undefined) params.limit = opts.limit;
      if (opts.startingAfter !== undefined)
        params.starting_after = opts.startingAfter;
      if (opts.endingBefore !== undefined)
        params.ending_before = opts.endingBefore;
      if (opts.startDate !== undefined) params.start_date = opts.startDate;
      if (opts.endDate !== undefined) params.end_date = opts.endDate;
      const resource = createResource();
      try {
        if (!c.agent && !c.formatExplicit) {
          let result: TaxLotsPage | null | undefined;
          let failure: unknown;
          return await renderInteractive(
            <TaxLotsList
              resource={resource}
              params={params}
              onComplete={(page) => {
                result = page;
              }}
              onError={(error) => {
                failure = error;
              }}
            />,
            () => {
              if (result === null) throw failure;
              if (result === undefined)
                throw new Error('Component exited without producing a result');
              return result;
            },
          );
        }
        return await resource.list(params);
      } catch (error) {
        const details = investmentApiError(error, 'list tax lots');
        if (details) return c.error(details);
        throw error;
      }
    },
  });
  return cli;
}
