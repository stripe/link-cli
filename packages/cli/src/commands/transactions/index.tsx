import type {
  AuthStorage,
  ITransactionsResource,
  ListTransactionsParams,
} from '@stripe/link-sdk';
import { Cli } from 'incur';
import React from 'react';
import { renderInteractive } from '../../utils/render-interactive';
import { requireAuth } from '../../utils/require-auth';
import { TransactionsList } from './list';
import { listOptions } from './schema';

export function createTransactionsCli(
  createResource: () => ITransactionsResource,
  authStorage?: AuthStorage,
  envAccessToken?: string,
) {
  const cli = Cli.create('transactions', {
    description: 'List transactions from Link and external accounts',
  });

  cli.command('list', {
    description:
      'List transactions from Link and external accounts, including non-Link activity',
    options: listOptions,
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage, envAccessToken)],
    async run(c) {
      const opts = c.options;
      const resource = createResource();

      const params: ListTransactionsParams = {};
      if (opts.limit !== undefined) params.limit = opts.limit;
      if (opts.startingAfter !== undefined)
        params.starting_after = opts.startingAfter;
      if (opts.endingBefore !== undefined)
        params.ending_before = opts.endingBefore;
      if (opts.startDate !== undefined) params.start_date = opts.startDate;
      if (opts.endDate !== undefined) params.end_date = opts.endDate;
      if (opts.category !== undefined) params.category = opts.category;
      if (opts.origin !== undefined) params.origin = opts.origin;
      if (opts.source.length > 0) params.sources = opts.source;

      if (!c.agent && !c.formatExplicit) {
        return renderInteractive(
          <TransactionsList
            resource={resource}
            params={params}
            onComplete={() => {}}
          />,
          () => resource.listTransactions(params),
        );
      }

      return resource.listTransactions(params);
    },
  });

  return cli;
}
