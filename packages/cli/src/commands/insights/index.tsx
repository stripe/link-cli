import type {
  AvailableInsightTypesPage,
  IInsightsResource,
  ListInsightTypesParams,
} from '@stripe/link-sdk';
import { Cli, z } from 'incur';
import type { CliAuthStorage } from '../../auth/storage';
import { renderInteractive } from '../../utils/render-interactive';
import { requireAuth } from '../../utils/require-auth';
import { AvailableTypes } from './available-types';

const paginationOptions = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Maximum number of insight types to return (1-100).'),
  startingAfter: z
    .string()
    .optional()
    .describe('Return insight types after this insight ID.'),
});

export function createInsightsCli(
  createResource: () => IInsightsResource,
  authStorage?: CliAuthStorage,
  envAccessToken?: string,
) {
  const cli = Cli.create('insights', {
    description: 'Discover available financial insight types',
  });

  cli.command('list-available-types', {
    description: 'List insight IDs, descriptions, and access requirements',
    options: paginationOptions,
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage, envAccessToken)],
    async run(c) {
      const params: ListInsightTypesParams = {};
      if (c.options.limit !== undefined) params.limit = c.options.limit;
      if (c.options.startingAfter !== undefined)
        params.starting_after = c.options.startingAfter;
      const resource = createResource();
      if (!c.agent && !c.formatExplicit) {
        let capturedResult: AvailableInsightTypesPage | null | undefined;
        return renderInteractive(
          <AvailableTypes
            resource={resource}
            params={params}
            onComplete={(result) => {
              capturedResult = result;
            }}
          />,
          () => {
            if (capturedResult === undefined)
              throw new Error('Component exited without producing a result');
            if (capturedResult === null)
              throw new Error('Failed to load available insight types');
            return capturedResult;
          },
        );
      }
      return resource.listAvailableTypes(params);
    },
  });

  return cli;
}
