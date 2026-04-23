import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

const __dirname = dirname(fileURLToPath(import.meta.url));
const skillContent = readFileSync(
  join(__dirname, '../../skills/create-payment-credential/SKILL.md'),
  'utf-8',
);
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));
let buildNumber = '0';
try {
  buildNumber = execSync('git rev-list --count HEAD', { stdio: 'pipe' })
    .toString()
    .trim();
} catch {
  // Not a git repo or git unavailable — build number stays '0'
}

export default defineConfig({
  entry: ['src/cli.tsx'],
  format: ['esm'],
  platform: 'node',
  target: 'node18',
  outDir: 'dist',
  clean: true,
  sourcemap: false,
  banner: { js: '#!/usr/bin/env node' },
  define: {
    SKILL_CONTENT: JSON.stringify(skillContent),
    __CLI_VERSION__: JSON.stringify(pkg.version),
    __BUILD_NUMBER__: JSON.stringify(buildNumber),
  },
});
