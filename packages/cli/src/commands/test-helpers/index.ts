import { Cli, z } from 'incur';
import type { CliAuthStorage } from '../../auth/storage';
import { requireAuth } from '../../utils/require-auth';
import type { TestHelpersSpendRequestResource } from './spend-request';

export function createTestHelpersCli(
  repository: TestHelpersSpendRequestResource,
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
    description: 'Approve a pending demo spend request',
    mcp: false,
    args: z.object({
      id: z.string().describe('Spend request ID'),
    }),
    outputPolicy: 'all' as const,
    middleware: [requireAuth(authStorage, envAccessToken)],
    async run(c) {
      return repository.approve(c.args.id);
    },
  });

  cli.command(spendRequest);
  return cli;
}
