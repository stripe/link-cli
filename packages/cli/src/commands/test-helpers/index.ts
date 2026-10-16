import type { ISpendRequestResource } from '@stripe/link-sdk';
import { Cli, z } from 'incur';
import type { CliAuthStorage } from '../../auth/storage';
import { requireAuth } from '../../utils/require-auth';
import { sanitizeText } from '../../utils/sanitize-text';

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
      'Approve a pending test-mode spend request and return its ID and status. Retrieve credentials separately. Live requests are rejected.',
    args: z.object({
      id: z
        .string()
        .describe('ID of a pending spend request created with --test'),
    }),
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage, envAccessToken)],
    async run(c) {
      const result = await repository.approveTestRequest(c.args.id);
      if (!c.agent && !c.formatExplicit) {
        process.stdout.write(
          `✓ Spend request ${sanitizeText(result.id)} ${sanitizeText(result.status)}.\n`,
        );
      }
      return result;
    },
  });

  spendRequest.command('deny', {
    description:
      'Deny a pending test-mode spend request and return its ID and status. Live requests are rejected.',
    args: z.object({
      id: z
        .string()
        .describe('ID of a pending spend request created with --test'),
    }),
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage, envAccessToken)],
    async run(c) {
      const result = await repository.denyTestRequest(c.args.id);
      if (!c.agent && !c.formatExplicit) {
        process.stdout.write(
          `✓ Spend request ${sanitizeText(result.id)} ${sanitizeText(result.status)}.\n`,
        );
      }
      return result;
    },
  });

  cli.command(spendRequest);
  return cli;
}
