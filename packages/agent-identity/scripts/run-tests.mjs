// Enumerate compiled tests explicitly so invocation works without shell glob expansion.

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const testDir = join(root, 'dist-test', 'test');

function collect(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(full));
    else if (entry.name.endsWith('.test.js')) out.push(relative(root, full));
  }
  return out.sort();
}

const files = collect(testDir);
if (files.length === 0) {
  console.error(
    `no compiled test files found under ${testDir}; run the build first`,
  );
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
