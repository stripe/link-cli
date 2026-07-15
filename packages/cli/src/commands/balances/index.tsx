import type {
  AuthStorage,
  IBalancesResource,
  ListBalancesParams,
} from '@stripe/link-sdk';
import { Cli } from 'incur';
import React from 'react';
import { renderInteractive } from '../../utils/render-interactive';
import { requireAuth } from '../../utils/require-auth';
import { BalancesList } from './list';
import { listOptions } from './schema';

export function createBalancesCli(
  createResource: () => IBalancesResource,
  authStorage?: AuthStorage,
  envAccessToken?: string,
) {
  const cli = Cli.create('balances', {
    description: 'List balances from your Link wallet',
  });

  cli.command('list', {
    description: 'List balances from your Link wallet',
    options: listOptions,
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage, envAccessToken)],
    async run(c) {
      const opts = c.options;
      const resource = createResource();

      const params: ListBalancesParams = {};
      if (opts.limit !== undefined) params.limit = opts.limit;
      if (opts.startingAfter !== undefined)
        params.starting_after = opts.startingAfter;
      if (opts.endingBefore !== undefined)
        params.ending_before = opts.endingBefore;

      if (!c.agent && !c.formatExplicit) {
        return renderInteractive(
          <BalancesList
            resource={resource}
            params={params}
            onComplete={() => {}}
          />,
          () => resource.listBalances(params),
        );
      }

      return resource.listBalances(params);
    },
  });

  return cli;
}
