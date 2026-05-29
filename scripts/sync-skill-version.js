#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(
  readFileSync(resolve(root, 'packages/cli/package.json'), 'utf8'),
);
const { version } = pkg;

function syncSkillVersion(label, path) {
  const content = readFileSync(path, 'utf8');
  const updated = content.replace(/^version:\s*.+$/m, `version: ${version}`);
  if (updated !== content) {
    writeFileSync(path, updated);
    console.log(`Updated ${label} version to ${version}`);
  } else {
    console.log(`${label} version already at ${version}`);
  }
}

function syncPluginJsonVersion(label, path) {
  const json = JSON.parse(readFileSync(path, 'utf8'));
  if (json.version !== version) {
    json.version = version;
    writeFileSync(path, JSON.stringify(json, null, 2) + '\n');
    console.log(`Updated ${label} version to ${version}`);
  } else {
    console.log(`${label} version already at ${version}`);
  }
}

syncSkillVersion('SKILL.md', resolve(root, 'skills/create-payment-credential/SKILL.md'));
syncPluginJsonVersion('.cursor-plugin/plugin.json', resolve(root, 'plugins/link/.cursor-plugin/plugin.json'));
syncPluginJsonVersion('.claude-plugin/plugin.json', resolve(root, 'plugins/link/.claude-plugin/plugin.json'));
syncPluginJsonVersion('.codex-plugin/plugin.json', resolve(root, 'plugins/link/.codex-plugin/plugin.json'));
