import type { ISummariesResource, SummariesPage } from '@stripe/link-sdk';
import { Cli } from 'incur';
import type { CliAuthStorage } from '../../auth/storage';
import { renderInteractive } from '../../utils/render-interactive';
import { requireAuth } from '../../utils/require-auth';
import { listAllSummaries, SummariesList } from './list';
import { listOptions } from './schema';

export function createSummariesCli(
  createResource: () => ISummariesResource,
  authStorage?: CliAuthStorage,
  envAccessToken?: string,
) {
  const cli = Cli.create('summaries', {
    description:
      'Summaries and aggregations of financial data from Link and external accounts',
  });
  cli.command('list', {
    description:
      'List summaries of financial data from Link and external accounts to answer common financial questions or provide preferences based on past purchase history',
    options: listOptions,
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage, envAccessToken)],
    async run(c) {
      const resource = createResource();
      const summaries = c.options.summary;
      if (!c.agent && !c.formatExplicit) {
        let capturedResult: SummariesPage | null | undefined;
        return renderInteractive(
          <SummariesList
            resource={resource}
            summaries={summaries}
            onComplete={(result) => {
              capturedResult = result;
            }}
          />,
          () => {
            if (capturedResult === undefined)
              throw new Error('Component exited without producing a result');
            if (capturedResult === null)
              throw new Error('Failed to load summaries');
            return capturedResult;
          },
        );
      }
      return listAllSummaries(resource, summaries);
    },
  });
  return cli;
}
