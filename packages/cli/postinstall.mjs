#!/usr/bin/env node

// Refresh the create-payment-credential skill whenever the CLI is (re)installed
// or upgraded via npm. Delegates to the openclaw `skills` CLI so the skill file
// stays in sync with the installed CLI version. Must never fail the install.

import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO = 'stripe/link-cli';

function run() {
  // Skip when running from the source monorepo (dev `pnpm install`). Installed
  // copies live under node_modules; the dev tree does not.
  if (!fileURLToPath(import.meta.url).includes('node_modules')) {
    return;
  }

  if (process.env.CI || process.env.LINK_CLI_SKIP_SKILL_INSTALL) {
    return;
  }

  process.stdout.write(
    'link-cli: refreshing the create-payment-credential skill…\n',
  );

  const result = spawnSync('npx', ['--yes', 'skills', 'add', REPO], {
    stdio: 'inherit',
    timeout: 60_000,
  });

  if (result.error || result.status !== 0) {
    process.stdout.write(
      `link-cli: skipped skill refresh; run 'npx skills add ${REPO}' manually.\n`,
    );
  }
}

try {
  run();
} catch {
  // Never fail the install.
}

process.exit(0);
