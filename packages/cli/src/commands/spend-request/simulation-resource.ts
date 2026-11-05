import {
  getScenarioIds,
  getSimulationScenario,
  listSimulationScenarios,
  scenarioAliases,
} from './simulation-scenarios';

// Command-level contract for the later backend transport. No scenario or action
// enums belong in this interface, so compatible backend additions can pass through.
export interface SpendRequestSimulationResponse
  extends Record<string, unknown> {
  next_action: Record<string, unknown> | null;
}
export interface SpendRequestSimulationCatalog extends Record<string, unknown> {
  data: Record<string, unknown>[];
}
export interface ISpendRequestSimulationResource {
  simulate(scenario: string): Promise<SpendRequestSimulationResponse>;
  listScenarios(): Promise<SpendRequestSimulationCatalog>;
}

export class InvalidSimulationScenarioError extends Error {
  readonly code = 'INVALID_INPUT';
  constructor() {
    super(
      `Unknown scenario. Use spend-request simulate --list-scenarios. Supported IDs: ${[...getScenarioIds(), ...Object.keys(scenarioAliases)].join(', ')}`,
    );
  }
}

/** Interim local fixtures. Replace this provider with authenticated backend GETs
 * after the simulation endpoints land; the command and envelopes stay the same.
 */
export class FixtureSpendRequestSimulationResource
  implements ISpendRequestSimulationResource
{
  async simulate(scenario: string): Promise<SpendRequestSimulationResponse> {
    const fixture = getSimulationScenario(scenario);
    if (!fixture) throw new InvalidSimulationScenarioError();
    return { next_action: fixture.action };
  }

  async listScenarios(): Promise<SpendRequestSimulationCatalog> {
    return {
      catalog_version: 1,
      data: listSimulationScenarios().map(
        ({ scenario, evidence_kind, ...descriptor }) => ({
          id: scenario,
          ...descriptor,
          evidence_kind:
            evidence_kind === 'verified_producer'
              ? 'production'
              : evidence_kind,
        }),
      ),
    };
  }
}
