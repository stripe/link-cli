#!/usr/bin/env node

// Refresh Link CLI's authored skills whenever the CLI is installed or upgraded
// via npm. Delegates to the `skills` CLI and must never fail the install.

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
    'link-cli: refreshing authored skills…\n',
  );

  const result = spawnSync(
    'npx',
    ['--yes', 'skills', 'add', REPO, '-g', '-y'],
    {
      stdio: 'inherit',
      timeout: 60_000,
    },
  );

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
