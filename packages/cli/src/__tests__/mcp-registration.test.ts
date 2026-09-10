import { execFile } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const CLI_PATH = new URL('../../dist/cli.js', import.meta.url).pathname;
const PACKAGE = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

let testDirectory: string | undefined;

afterEach(() => {
  if (testDirectory) rmSync(testDirectory, { force: true, recursive: true });
  testDirectory = undefined;
});

describe('MCP registration', () => {
  it('registers the versioned scoped package', async () => {
    testDirectory = mkdtempSync(path.join(os.tmpdir(), 'link-cli-mcp-test-'));
    const capturePath = path.join(testDirectory, 'arguments.json');
    const npxPath = path.join(testDirectory, 'npx');
    writeFileSync(
      npxPath,
      `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.LINK_MCP_TEST_CAPTURE, JSON.stringify(process.argv.slice(2)));
`,
    );
    chmodSync(npxPath, 0o755);

    await execFileAsync(
      process.execPath,
      [CLI_PATH, 'mcp', 'add', '--agent', 'cursor'],
      {
        env: {
          ...process.env,
          LINK_MCP_TEST_CAPTURE: capturePath,
          npm_config_user_agent: 'npm/10.0.0 node/v22.0.0',
          PATH: `${testDirectory}:${process.env.PATH}`,
        },
      },
    );

    const argumentsPassed = JSON.parse(readFileSync(capturePath, 'utf8'));
    expect(argumentsPassed).toContain(
      `npx @stripe/link-cli@${PACKAGE.version} --mcp`,
    );
  });
});
