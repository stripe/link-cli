import { expect, it } from 'vitest';
import { buildMcpCommand, detectPackageRunner } from '../package-runner';

it.each([
  ['npm user agent', ['npm/10.0.0'], 'npx'],
  ['npm before a pnpm executable', ['npm/10.0.0', '/bin/pnpm'], 'npx'],
  ['pnpm executable', ['', '/bin/pnpm.cjs'], 'pnpx'],
  ['Bun entrypoint', ['', '', '/tmp/.bun/bin/cli'], 'bunx'],
])('detects the package runner from the %s', (_, hints, expected) => {
  expect(detectPackageRunner(hints)).toBe(expected);
});

it('uses the current executable for a standalone SEA', () => {
  expect(
    buildMcpCommand('@stripe/link-cli', '1.2.3', {
      sea: true,
      executable: '/Applications/Link CLI/link-cli',
    }),
  ).toBe('"/Applications/Link CLI/link-cli" --mcp');
});
