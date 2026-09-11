import { expect, it } from 'vitest';
import { detectPackageRunner } from '../package-runner';

it.each([
  ['npm user agent', ['npm/10.0.0'], 'npx'],
  ['npm before a pnpm executable', ['npm/10.0.0', '/bin/pnpm'], 'npx'],
  ['pnpm executable', ['', '/bin/pnpm.cjs'], 'pnpx'],
  ['Bun entrypoint', ['', '', '/tmp/.bun/bin/cli'], 'bunx'],
])('detects the package runner from the %s', (_, hints, expected) => {
  expect(detectPackageRunner(hints)).toBe(expected);
});
