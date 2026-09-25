import type { IApprovalPolicyResource } from '@stripe/link-sdk';
import { Cli } from 'incur';
import type { CliAuthStorage } from '../../auth/storage';
import { renderInteractive } from '../../utils/render-interactive';
import { requireAuth } from '../../utils/require-auth';
import { ApprovalPolicyRetrieve } from './retrieve';

export function createApprovalPolicyCli(
  createResource: () => IApprovalPolicyResource,
  authStorage?: CliAuthStorage,
  envAccessToken?: string,
) {
  const cli = Cli.create('approval-policy', {
    description: 'Approval policy commands',
  });

  cli.command('retrieve', {
    description: 'Retrieve the approval policy for the current app and user',
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage, envAccessToken)],
    async run(c) {
      const resource = createResource();

      if (!c.agent && !c.formatExplicit) {
        return renderInteractive(
          <ApprovalPolicyRetrieve resource={resource} onComplete={() => {}} />,
          () => resource.retrieve(),
        );
      }

      return resource.retrieve();
    },
  });

  return cli;
}
