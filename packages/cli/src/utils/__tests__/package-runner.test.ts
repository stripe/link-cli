import { afterEach, expect, it, vi } from 'vitest';
import { buildMcpCommand } from '../package-runner';

afterEach(() => {
  vi.unstubAllEnvs();
});

it.each([
  [
    'npm',
    'npm/10.0.0 node/v24.0.0',
    '/usr/lib/node_modules/npm/bin/npm-cli.js',
  ],
  ['pnpm', 'pnpm/9.0.0 npm/? node/v24.0.0', '/usr/local/bin/pnpm.cjs'],
  ['Bun', 'bun/1.1.0 npm/? node/v24.0.0', '/Users/me/.bun/bin/bun'],
])('uses the installed link-cli binary under %s', (_, userAgent, execPath) => {
  vi.stubEnv('npm_config_user_agent', userAgent);
  vi.stubEnv('npm_execpath', execPath);

  expect(
    buildMcpCommand({
      entry: '/tmp/.pnpm/node_modules/@stripe/link-cli/dist/cli.js',
      executable: '/usr/local/bin/node',
    }),
  ).toBe('link-cli --mcp');
});

it('uses the current executable for a standalone SEA', () => {
  expect(
    buildMcpCommand({
      entry: '/Applications/Link CLI/link-cli',
      executable: '/Applications/Link CLI/link-cli',
    }),
  ).toBe('"/Applications/Link CLI/link-cli" --mcp');
});

it('escapes double quotes in a standalone SEA path', () => {
  expect(
    buildMcpCommand({
      entry: '/opt/Link "CLI"/link-cli',
      executable: '/opt/Link "CLI"/link-cli',
    }),
  ).toBe('"/opt/Link \\"CLI\\"/link-cli" --mcp');
});
