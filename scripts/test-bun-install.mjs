// Packaging regression: pnpm run build && node scripts/test-bun-install.mjs
// Optional argument: an existing CLI tarball (to test a pre-fix build).
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const temp = mkdtempSync(join(tmpdir(), 'link-bun-spinner-'));
try {
  const tarball = process.argv[2]
    ? resolve(process.argv[2])
    : join(temp, 'cli.tgz');
  if (!process.argv[2]) {
    execFileSync('pnpm', ['pack', '--out', tarball], {
      cwd: fileURLToPath(new URL('../packages/cli/', import.meta.url)),
      stdio: 'inherit',
    });
  }
  // Recreate a shared global dependency layout without changing the user's tools.
  writeFileSync(join(temp, 'package.json'), '{"private":true,"type":"module"}');
  execFileSync(
    'bun',
    [
      'add',
      '--ignore-scripts',
      tarball,
      'react@19.2.7',
      'ink@6.8.0',
      'ink-spinner@5.0.0',
    ],
    {
      cwd: temp,
      stdio: 'inherit',
    },
  );
  const entry = join(temp, 'node_modules/@stripe/link-cli/dist/cli.js');
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { createRequire } from 'node:module';
    import assert from 'node:assert/strict';
    const cliRequire = createRequire(${JSON.stringify(entry)});
    const spinnerRequire = createRequire(cliRequire.resolve('ink-spinner'));
    assert.notEqual(cliRequire.resolve('react'), spinnerRequire.resolve('react'));
    // Exercise the real interactive command without a terminal or real wallet.
    process.stdout.isTTY = true;
    process.stdin.isTTY = true;
    process.stdin.setRawMode = () => {};
    globalThis.fetch = (url) => String(url).startsWith('http://127.0.0.1:1')
      ? new Promise(() => {})
      : Promise.reject(new Error('Network disabled for packaging test'));
    process.argv = [process.execPath, ${JSON.stringify(entry)}, 'onboard'];
    await import(${JSON.stringify(pathToFileURL(entry).href)});
  `,
    ],
    {
      cwd: temp,
      env: {
        ...process.env,
        LINK_AUTH_FILE: join(temp, 'auth.json'),
        LINK_ACCESS_TOKEN: '',
        LINK_REFRESH_TOKEN: '',
        // Defense in depth: never contact Link, even if a fetch path changes.
        LINK_AUTH_BASE_URL: 'http://127.0.0.1:1',
        LINK_API_BASE_URL: 'http://127.0.0.1:1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  let output = '';
  let rendered;
  const timeout = setTimeout(() => child.kill('SIGKILL'), 30_000);
  function collect(chunk) {
    output += chunk;
    // Let the spinner tick before stopping this intentionally pending login.
    if (!rendered && output.includes('Initiating authentication')) {
      rendered = setTimeout(() => child.kill('SIGTERM'), 500);
    }
  }
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  let exitSignal;
  try {
    exitSignal = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (_code, signal) => resolve(signal));
    });
  } finally {
    clearTimeout(timeout);
    clearTimeout(rendered);
  }
  assert.doesNotMatch(
    output,
    /Invalid hook call|Cannot read properties|AssertionError/,
    output,
  );
  assert.match(output, /Initiating authentication/, output);
  assert.equal(
    exitSignal,
    'SIGTERM',
    `CLI exited before the spinner check: ${output}`,
  );
  console.log(
    'PASS: onboard renders its spinner with a conflicting hoisted React installed.',
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
