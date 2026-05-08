#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(
  readFileSync(resolve(root, 'packages/cli/package.json'), 'utf8'),
);
const skillPath = resolve(root, 'skills/create-payment-credential/SKILL.md');
const skill = readFileSync(skillPath, 'utf8');

const updated = skill.replace(/^version:\s*.+$/m, `version: ${pkg.version}`);

if (updated !== skill) {
  writeFileSync(skillPath, updated);
  console.log(`Updated SKILL.md version to ${pkg.version}`);
} else {
  console.log(`SKILL.md version already at ${pkg.version}`);
}
