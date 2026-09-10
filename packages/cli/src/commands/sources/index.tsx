import type { ISourcesResource, ListSourcesParams } from '@stripe/link-sdk';
import { Cli } from 'incur';
import React from 'react';
import type { CliAuthStorage } from '../../auth/storage';
import { renderInteractive } from '../../utils/render-interactive';
import { requireAuth } from '../../utils/require-auth';
import { SourcesList } from './list';
import { listOptions } from './schema';

export function createSourcesCli(
  createResource: () => ISourcesResource,
  authStorage?: CliAuthStorage,
  envAccessToken?: string,
) {
  const cli = Cli.create('sources', {
    description: '[beta] List sources from your Link wallet',
  });

  cli.command('list', {
    description: 'List sources from your Link wallet',
    options: listOptions,
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage, envAccessToken)],
    async run(c) {
      const opts = c.options;
      const resource = createResource();

      const params: ListSourcesParams = {};
      if (opts.limit !== undefined) params.limit = opts.limit;
      if (opts.startingAfter !== undefined)
        params.starting_after = opts.startingAfter;
      if (opts.endingBefore !== undefined)
        params.ending_before = opts.endingBefore;

      if (!c.agent && !c.formatExplicit) {
        return renderInteractive(
          <SourcesList
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

  return cli;
}
