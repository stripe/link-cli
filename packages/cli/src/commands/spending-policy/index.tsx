import type { ISpendingPolicyResource } from '@stripe/link-sdk';
import { Cli } from 'incur';
import type { CliAuthStorage } from '../../auth/storage';
import { renderInteractive } from '../../utils/render-interactive';
import { requireAuth } from '../../utils/require-auth';
import { SpendingPolicyRetrieve } from './retrieve';

export function createSpendingPolicyCli(
  createResource: () => ISpendingPolicyResource,
  authStorage?: CliAuthStorage,
  envAccessToken?: string,
) {
  const cli = Cli.create('spending-policy', {
    description: 'Spending policy commands',
  });

  cli.command('retrieve', {
    description: 'Retrieve the spending policy for the current app and user',
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage, envAccessToken)],
    async run(c) {
      const resource = createResource();

      if (!c.agent && !c.formatExplicit) {
        return renderInteractive(
          <SpendingPolicyRetrieve resource={resource} onComplete={() => {}} />,
          () => resource.retrieve(),
        );
      }

      return resource.retrieve();
    },
  });

  return cli;
}
