import { afterEach, describe, expect, it, vi } from 'vitest';
import { Storage } from '../../../auth/storage';
import { ResourceFactory } from '../../../utils/resource-factory';
import { createNextActionCli } from '../index';
import { simulationWarning } from '../simulate';
import {
  getScenarioIds,
  getSimulationScenario,
  listSimulationScenarios,
} from '../simulation-scenarios';

async function run(args: string[]) {
  let stdout = '';
  let exitCode = 0;
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  await createNextActionCli().serve(args, {
    stdout: (text) => {
      stdout += text;
    },
    exit: (code) => {
      exitCode = code;
    },
  });
  const warnings = stderr.mock.calls.map(([text]) => String(text)).join('');
  stderr.mockRestore();
  return { stdout, exitCode, warnings };
}

afterEach(() => vi.restoreAllMocks());

describe('next-action simulate', () => {
  it.each(getScenarioIds())(
    'returns exactly one deterministic snapshot for %s without auth or resources',
    async (scenario) => {
      const auth = vi
        .spyOn(Storage.prototype, 'getTokens')
        .mockImplementation(() => {
          throw new Error('auth forbidden');
        });
      const resource = vi
        .spyOn(ResourceFactory.prototype, 'createSpendRequestResource')
        .mockImplementation(() => {
          throw new Error('resource forbidden');
        });
      const fetch = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('network forbidden'));
      const args = ['simulate', '--scenario', scenario, '--format', 'json'];
      const result = await run(args);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual([
        { next_action: getSimulationScenario(scenario)?.action },
      ]);
      expect(result.warnings).toBe(`${simulationWarning}\n`);
      expect(result.stdout).not.toContain('Simulation only');
      expect(await run(args)).toEqual(result);
      expect(auth).not.toHaveBeenCalled();
      expect(resource).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('resolves visa_otp without adding a list row', async () => {
    expect(
      await run(['simulate', '--scenario', 'visa_otp', '--format', 'json']),
    ).toEqual(
      await run([
        'simulate',
        '--scenario',
        'partner_auth_challenge',
        '--format',
        'json',
      ]),
    );
    const result = await run([
      'simulate',
      '--list-scenarios',
      '--format',
      'json',
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.warnings).toBe('');
    expect(JSON.parse(result.stdout)).toEqual(listSimulationScenarios());
  });

  it.each([
    [],
    ['--scenario', 'ssn_verification', '--list-scenarios'],
    ['--scenario', 'unknown'],
    ['--scenario', 'SSN_VERIFICATION'],
    ['--scenario', ''],
  ])('reports INVALID_INPUT with supported IDs: %j', async (...flags) => {
    const result = await run(['simulate', ...flags, '--format', 'json']);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('INVALID_INPUT');
    expect(result.stdout).toContain('visa_otp');
    expect(result.stdout).toContain('unknown_action_type');
    expect(result.warnings).toBe('');
  });

  it.each([
    ['lsrq_example'],
    ['--test'],
    ['--include', 'card'],
    ['--output-file', '/tmp/example'],
    ['--interval', '2'],
    ['--scenario'],
    ['--list-scenarios', 'wat'],
  ])('rejects unsupported arguments/flags: %j', async (...flags) => {
    const result = await run([
      'simulate',
      '--scenario',
      'ssn_verification',
      ...flags,
      '--format',
      'json',
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.warnings).toBe('');
  });

  it.each([true, false])(
    'renders all output with TTY=%s in explicit and default modes',
    async (isTTY) => {
      const descriptor = Object.getOwnPropertyDescriptor(
        process.stdout,
        'isTTY',
      );
      Object.defineProperty(process.stdout, 'isTTY', {
        value: isTTY,
        configurable: true,
      });
      try {
        for (const flags of [
          [],
          ['--format', 'json'],
          ['--format', 'yaml'],
          ['--format', 'toon'],
        ]) {
          const result = await run([
            'simulate',
            '--scenario',
            'ssn_verification',
            ...flags,
          ]);
          expect(result.exitCode).toBe(0);
          expect(result.stdout).toContain(
            getSimulationScenario('ssn_verification')?.action?.action_url,
          );
          expect(result.stdout.replace(/\s+/g, ' ')).toContain(
            'Please verify your SSN to continue.',
          );
        }
      } finally {
        if (descriptor)
          Object.defineProperty(process.stdout, 'isTTY', descriptor);
        else Reflect.deleteProperty(process.stdout, 'isTTY');
      }
    },
  );

  it('documents CLI help and excludes simulation from MCP search', async () => {
    expect((await run(['simulate', '--help'])).stdout).toContain(
      'Testing only',
    );
    const cli = createNextActionCli();
    for (const [method, params] of [
      ['tools/list', {}],
      [
        'tools/call',
        { name: 'search_tools', arguments: { query: 'simulate' } },
      ],
    ] as const) {
      const response = await cli.fetch(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        }),
      );
      expect(JSON.stringify(await response.json())).not.toContain(
        'next_action_simulate',
      );
    }
  });
});
