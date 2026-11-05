import type { ISpendRequestResource } from '@stripe/link-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Storage } from '../../../auth/storage';
import { ResourceFactory } from '../../../utils/resource-factory';
import { createSpendRequestCli } from '../index';
import { simulationWarning } from '../simulate';
import { FixtureSpendRequestSimulationResource } from '../simulation-resource';
import { getScenarioIds, getSimulationScenario } from '../simulation-scenarios';

async function run(
  args: string[],
  settings: Parameters<typeof createSpendRequestCli>[3] = {},
  envAccessToken: string | null = 'test-token',
  authStorage?: Storage,
) {
  let stdout = '';
  let exitCode = 0;
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  await createSpendRequestCli(
    {} as ISpendRequestResource,
    authStorage,
    envAccessToken ?? undefined,
    settings,
  ).serve(args, {
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

describe('spend-request simulate', () => {
  it.each(getScenarioIds())(
    'returns exactly one deterministic snapshot for %s without real payment calls',
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
    expect(result.warnings).toBe(`${simulationWarning}\n`);
    expect(JSON.parse(result.stdout)).toEqual([
      await new FixtureSpendRequestSimulationResource().listScenarios(),
    ]);
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
    expect(result.stdout).toContain('--list-scenarios');
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

  it.each([['--scenario', 'ssn_verification'], ['--list-scenarios']])(
    'requires a session or configured token: %j',
    async (...flags) => {
      const store = new Storage();
      const auth = vi.spyOn(store, 'isAuthenticated').mockReturnValue(false);
      const factory = vi.fn(() => new FixtureSpendRequestSimulationResource());
      const args = ['simulate', ...flags, '--format', 'json'];
      const denied = await run(
        args,
        { createSimulationResource: factory },
        null,
        store,
      );
      expect(denied.exitCode).toBe(1);
      expect(denied.stdout).toContain('NOT_AUTHENTICATED');
      expect(denied.warnings).toBe('');
      expect(factory).not.toHaveBeenCalled();
      auth.mockReturnValue(true);
      expect(
        (await run(args, { createSimulationResource: factory }, null, store))
          .exitCode,
      ).toBe(0);
      expect(factory).toHaveBeenCalledOnce();
    },
  );

  it('validates selectors before constructing or calling a resource', async () => {
    const factory = vi.fn(() => new FixtureSpendRequestSimulationResource());
    for (const flags of [
      [],
      ['--scenario', 'x', '--list-scenarios'],
      ['--scenario', '   '],
    ]) {
      const result = await run(['simulate', ...flags, '--format', 'json'], {
        createSimulationResource: factory,
      });
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('INVALID_INPUT');
    }
    expect(factory).not.toHaveBeenCalled();
  });

  it('forwards opaque selectors and additive envelopes through the resource boundary', async () => {
    const response = {
      next_action: {
        type: 'future_backend_type',
        resolution: 'future_resolution',
        nested: { value: ['future'] },
      },
      extra: { version: 42 },
    };
    const catalog = {
      catalog_version: 42,
      data: [{ id: 'new_alias', extra: { type: 'future' } }],
      extra: true,
    };
    const resource = {
      simulate: vi.fn().mockResolvedValue(response),
      listScenarios: vi.fn().mockResolvedValue(catalog),
    };
    const factory = vi.fn(() => resource);
    const result = await run(
      ['simulate', '--scenario', 'new_alias', '--format', 'json'],
      { createSimulationResource: factory },
    );
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([response]);
    expect(resource.simulate).toHaveBeenCalledExactlyOnceWith('new_alias');
    expect(resource.listScenarios).not.toHaveBeenCalled();
    const list = await run(
      ['simulate', '--list-scenarios', '--format', 'json'],
      { createSimulationResource: factory },
    );
    expect(JSON.parse(list.stdout)).toEqual([catalog]);
    expect(resource.listScenarios).toHaveBeenCalledOnce();
  });

  it('does not fall back to fixtures or warn after a provider error', async () => {
    const resource = {
      simulate: vi.fn().mockRejectedValue(
        Object.assign(new Error('Simulation is unavailable'), {
          code: 'simulation_unavailable',
        }),
      ),
      listScenarios: vi.fn(),
    };
    const result = await run(
      ['simulate', '--scenario', 'ssn_verification', '--format', 'json'],
      { createSimulationResource: () => resource },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('simulation_unavailable');
    expect(result.stdout).not.toContain('next_action');
    expect(result.warnings).toBe('');
  });

  it('documents CLI help and excludes simulation from MCP search', async () => {
    expect((await run(['simulate', '--help'])).stdout).toContain(
      'Testing only',
    );
    const cli = createSpendRequestCli(
      {} as ISpendRequestResource,
      undefined,
      'test-token',
    );
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
        'spend_request_simulate',
      );
    }
  });
});
