import type { Cli } from 'incur';
import { z } from 'zod';
import { simulateOptions } from './schema';
import {
  getScenarioIds,
  getSimulationScenario,
  listSimulationScenarios,
  scenarioAliases,
} from './simulation-scenarios';

export const simulationWarning =
  'Simulation only: no request or verification session was created; URLs are synthetic.';

export function registerSimulate(cli: Cli.Cli) {
  cli.command('simulate', {
    description:
      'Testing only: deterministic, unauthenticated, offline next-action sample responses for agent evaluation',
    // Incur ignores positionals without an args schema; explicitly reject them.
    args: z.object({
      unexpected: z
        .array(z.string())
        .max(0, 'Simulation accepts no positional arguments.')
        .optional(),
    }),
    options: simulateOptions,
    outputPolicy: 'all',
    mcp: false,
    async *run(c) {
      const { scenario, listScenarios } = c.options;
      const supported = [...getScenarioIds(), ...Object.keys(scenarioAliases)];
      if ((scenario !== undefined) === listScenarios) {
        return c.error({
          code: 'INVALID_INPUT',
          message: `Choose exactly one of --scenario or --list-scenarios. Supported IDs: ${supported.join(', ')}`,
        });
      }
      if (listScenarios) {
        yield* listSimulationScenarios();
        return;
      }
      const fixture = getSimulationScenario(scenario ?? '');
      if (!fixture) {
        return c.error({
          code: 'INVALID_INPUT',
          message: `Unknown scenario. Supported IDs: ${supported.join(', ')}`,
        });
      }
      process.stderr.write(`${simulationWarning}\n`);
      yield { next_action: fixture.action };
    },
  });
}
