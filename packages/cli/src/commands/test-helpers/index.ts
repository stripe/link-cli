import type { ISpendRequestResource } from '@stripe/link-sdk';
import { Cli, z } from 'incur';
import type { CliAuthStorage } from '../../auth/storage';
import { requireAuth } from '../../utils/require-auth';

export function createTestHelpersCli(
  repository: ISpendRequestResource,
  authStorage?: CliAuthStorage,
  envAccessToken?: string,
) {
  const cli = Cli.create('test-helpers', {
    description: 'Helpers for testing Link integrations',
  });
  const spendRequest = Cli.create('spend-request', {
    description: 'Spend request test helpers',
  });

  spendRequest.command('approve', {
    description:
      'Approve a pending test-mode spend request and return the updated resource. Live requests are rejected.',
    args: z.object({
      id: z
        .string()
        .describe('ID of a pending spend request created with --test'),
    }),
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage, envAccessToken)],
    async run(c) {
      return repository.approveTestRequest(c.args.id);
    },
  });

  cli.command(spendRequest);
  return cli;
}
