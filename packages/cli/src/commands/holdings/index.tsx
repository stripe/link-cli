import type {
  HoldingsPage,
  IHoldingsResource,
  ListHoldingsParams,
} from '@stripe/link-sdk';
import { Cli } from 'incur';
import type { CliAuthStorage } from '../../auth/storage';
import { investmentApiError } from '../../utils/investment-api-error';
import { renderInteractive } from '../../utils/render-interactive';
import { requireAuth } from '../../utils/require-auth';
import { HoldingsList } from './list';
import { listOptions } from './schema';

export function createHoldingsCli(
  createResource: () => IHoldingsResource,
  authStorage?: CliAuthStorage,
  envAccessToken?: string,
) {
  const cli = Cli.create('holdings', {
    description: '[beta] Read cached investment holdings for a Link source',
  });
  cli.command('list', {
    description:
      'List one page of read-only holding snapshots; requires read_holdings access',
    options: listOptions,
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage, envAccessToken)],
    async run(c) {
      const opts = c.options;
      const params: ListHoldingsParams = { source: opts.source };
      if (opts.limit !== undefined) params.limit = opts.limit;
      if (opts.startingAfter !== undefined)
        params.starting_after = opts.startingAfter;
      if (opts.endingBefore !== undefined)
        params.ending_before = opts.endingBefore;
      const resource = createResource();
      try {
        if (!c.agent && !c.formatExplicit) {
          let result: HoldingsPage | null | undefined;
          let failure: unknown;
          return await renderInteractive(
            <HoldingsList
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
        const details = investmentApiError(error, 'list holdings');
        if (details) return c.error(details);
        throw error;
      }
    },
  });
  return cli;
}
