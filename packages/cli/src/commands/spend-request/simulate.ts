import type { Cli } from 'incur';
import { z } from 'zod';
import type { CliAuthStorage } from '../../auth/storage';
import { requireAuth } from '../../utils/require-auth';
import type { ISpendRequestSimulationResource } from './simulation-resource';
import { simulateOptions } from './simulation-schema';

export const simulationWarning =
  'Simulation only: no spend request or verification session was created; URLs are synthetic.';

export function registerSimulate(
  cli: Cli.Cli,
  createResource: () => ISpendRequestSimulationResource,
  authStorage?: CliAuthStorage,
  envAccessToken?: string,
) {
  cli.command('simulate', {
    description:
      'Testing only: sample spend-request next actions for agent evaluation. Requires login or a configured access token; currently uses local fixtures.',
    // Incur otherwise ignores extra positional arguments.
    args: z.object({
      unexpected: z
        .array(z.string())
        .max(0, 'Simulation accepts no positional arguments.')
        .optional(),
    }),
    options: simulateOptions,
    middleware: [requireAuth(authStorage, envAccessToken)],
    outputPolicy: 'all',
    mcp: false,
    async *run(c) {
      const { scenario, listScenarios } = c.options;
      if (
        (scenario !== undefined) === listScenarios ||
        (scenario !== undefined && !scenario.trim())
      ) {
        return c.error({
          code: 'INVALID_INPUT',
          message:
            'Choose exactly one of a nonblank --scenario or --list-scenarios. Use spend-request simulate --list-scenarios to discover IDs.',
        });
      }
      try {
        const resource = createResource();
        const response = listScenarios
          ? await resource.listScenarios()
          : await resource.simulate(scenario ?? '');
        process.stderr.write(`${simulationWarning}\n`);
        yield response;
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          typeof error.code === 'string'
        ) {
          return c.error({ code: error.code, message: error.message });
        }
        throw error;
      }
    },
  });
}
