import type {
  ITransactionsResource,
  ListTransactionsParams,
  Transaction,
  UpdateTransactionParams,
} from '@stripe/link-sdk';
import { LinkApiError } from '@stripe/link-sdk';
import { Cli, z } from 'incur';
import React from 'react';
import type { CliAuthStorage } from '../../auth/storage';
import { renderInteractive } from '../../utils/render-interactive';
import { requireAuth } from '../../utils/require-auth';
import { TransactionsList } from './list';
import { listOptions, updateOptions } from './schema';
import { TransactionUpdate } from './update';

export function createTransactionsCli(
  createResource: () => ITransactionsResource,
  authStorage?: CliAuthStorage,
  envAccessToken?: string,
) {
  const cli = Cli.create('transactions', {
    description:
      '[beta] List and update transactions from Link and external accounts',
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
          () => resource.list(params),
        );
      }

      return resource.list(params);
    },
  });

  cli.command('update', {
    description: 'Update a transaction category or description',
    args: z.object({
      id: z.string().describe('Transaction ID (e.g. lbctxn_...)'),
    }),
    options: updateOptions,
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage, envAccessToken)],
    async run(c) {
      const id = c.args.id;
      const opts = c.options;
      const resource = createResource();

      const present = (v: string | undefined) =>
        v !== undefined && v.trim() !== '' ? v : undefined;

      const params: UpdateTransactionParams = {};
      const category = present(opts.category);
      const description = present(opts.description);
      if (category !== undefined) params.category = category;
      if (description !== undefined) params.description = description;

      if (category === undefined && description === undefined) {
        return c.error({
          code: 'MISSING_UPDATE_FIELDS',
          message: 'Must provide at least one of --category or --description.',
        });
      }

      if (!c.agent && !c.formatExplicit) {
        let capturedResult: Transaction | null = null;
        return renderInteractive(
          <TransactionUpdate
            resource={resource}
            id={id}
            params={params}
            onComplete={(result) => {
              capturedResult = result;
            }}
          />,
          () => {
            if (!capturedResult)
              throw new Error('Component exited without producing a result');
            return capturedResult;
          },
        );
      }

      try {
        return await resource.update(id, params);
      } catch (err) {
        if (err instanceof LinkApiError) {
          const apiErr = err.details as {
            error?: { code?: string; message?: string };
          };
          return c.error({
            code: apiErr?.error?.code ?? 'API_ERROR',
            message: apiErr?.error?.message ?? err.message,
          });
        }
        throw err;
      }
    },
  });

  return cli;
}
