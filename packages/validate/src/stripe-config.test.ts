import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readStripeTestKey } from './stripe-config.ts';

let directory: string;
let configPath: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'link-validate-config-'));
  mkdirSync(join(directory, 'stripe'));
  configPath = join(directory, 'stripe', 'config.toml');
  vi.stubEnv('XDG_CONFIG_HOME', directory);
  vi.stubEnv('STRIPE_API_KEY', '');
  vi.stubEnv('STRIPE_SECRET_KEY', '');
  vi.stubEnv('STRIPE_PROJECT_NAME', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

it('prefers an environment key over the Stripe CLI config', () => {
  writeFileSync(configPath, 'not valid TOML');
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_env');
  expect(readStripeTestKey()).toBe('sk_test_env');
});

it('reads the selected profile test key', () => {
  writeFileSync(
    configPath,
    `[default]
test_mode_api_key = 'sk_test_default'
live_mode_api_key = 'sk_live_unused'
[other]
test_mode_api_key = 'sk_test_other'
`,
  );
  expect(readStripeTestKey()).toBe('sk_test_default');
  vi.stubEnv('STRIPE_PROJECT_NAME', 'other');
  expect(readStripeTestKey()).toBe('sk_test_other');
});

it('prints login instructions when no test key exists', () => {
  expect(() => readStripeTestKey()).toThrow(
    "stripe login --non-interactive --project-name 'default'",
  );
});

it('does not echo config contents in parse errors', () => {
  writeFileSync(configPath, `[default]\ntest_mode_api_key = 'sk_test_secret`);
  expect(() => readStripeTestKey()).toThrow(
    /^Could not parse Stripe CLI config\. Check its TOML syntax\.$/,
  );
});
