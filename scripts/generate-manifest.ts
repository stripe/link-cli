#!/usr/bin/env bun
/**
 * Emit dist-bin/manifest.json with sha256 checksums + download URLs for every
 * binary in dist-bin/. Consumed by release-binaries.yml after the binaries are
 * built. Downstream consumers (Houston, etc.) pin against this manifest.
 *
 * Usage:
 *   bun run scripts/generate-manifest.ts <version>
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const version = process.argv[2];
if (!version) {
  console.error('Usage: bun run scripts/generate-manifest.ts <version>');
  process.exit(1);
}

const baseUrl = `https://github.com/stripe/link-cli/releases/download/${version}`;
const distDir = 'dist-bin';
const files = readdirSync(distDir).filter((f) => f.startsWith('link-cli-'));

const binaries: Record<string, { file: string; sha256: string; url: string }> =
  {};

for (const file of files) {
  const target = file.replace(/^link-cli-/, '').replace(/\.exe$/, '');
  const buf = readFileSync(join(distDir, file));
  const sha256 = createHash('sha256').update(buf).digest('hex');
  binaries[target] = { file, sha256, url: `${baseUrl}/${file}` };
}

const manifest = {
  version,
  generated_at: new Date().toISOString(),
  binaries,
};

writeFileSync(
  join(distDir, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(JSON.stringify(manifest, null, 2));
