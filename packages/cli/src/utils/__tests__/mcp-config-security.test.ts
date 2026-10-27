import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const REPO_ROOT = new URL('../../../../../', import.meta.url).pathname;
const MCP_CONFIG_PATH = path.join(REPO_ROOT, '.mcp.json');
const PLUGIN_MCP_CONFIG_PATH = path.join(REPO_ROOT, 'plugins/link/.mcp.json');

interface McpServerConfig {
  command: string;
  args: string[];
}

function readLinkServer(): McpServerConfig {
  const config = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf8'));
  return config.mcpServers.link;
}

describe('plugin MCP config', () => {
  it('launches the installed link-cli binary without a package runner', () => {
    const server = readLinkServer();

    expect(server.command).toBe('link-cli');
    expect(server.args).toEqual(['--mcp']);
    for (const part of [server.command, ...server.args]) {
      expect(part).not.toMatch(
        /^(npx|pnpx|bunx|npm|pnpm|yarn|bun)$|@stripe\/link-cli/,
      );
    }
  });

  it('is shared by the Claude and Codex plugin', () => {
    expect(fs.realpathSync(PLUGIN_MCP_CONFIG_PATH)).toBe(
      fs.realpathSync(MCP_CONFIG_PATH),
    );
  });
});

describe.skipIf(process.platform === 'win32')(
  'plugin MCP startup from an untrusted repository',
  () => {
    let tmpDir: string;
    let repoDir: string;
    let trustedDir: string;
    let server: http.Server;
    let registryRequests = 0;

    function writeMarkerScript(file: string, marker: string) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        `#!/bin/sh\necho ran > ${JSON.stringify(path.join(tmpDir, marker))}\n`,
        { mode: 0o755 },
      );
    }

    beforeAll(async () => {
      server = http.createServer((_req, res) => {
        registryRequests++;
        res.writeHead(404).end();
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      const { port } = server.address() as AddressInfo;

      tmpDir = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), 'link-mcp-security-')),
      );
      repoDir = path.join(tmpDir, 'repo');
      trustedDir = path.join(tmpDir, 'trusted');

      fs.mkdirSync(repoDir, { recursive: true });
      fs.writeFileSync(
        path.join(repoDir, '.npmrc'),
        `registry=http://127.0.0.1:${port}/\n`,
      );
      const pkgDir = path.join(repoDir, 'node_modules/@stripe/link-cli');
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({
          name: '@stripe/link-cli',
          version: '0.0.0',
          bin: { 'link-cli': 'bin.sh' },
        }),
      );
      writeMarkerScript(path.join(pkgDir, 'bin.sh'), 'repo-marker');
      writeMarkerScript(
        path.join(repoDir, 'node_modules/.bin/link-cli'),
        'repo-marker',
      );
      writeMarkerScript(path.join(trustedDir, 'link-cli'), 'trusted-marker');
    });

    afterAll(async () => {
      await new Promise((resolve) => server?.close(resolve));
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('runs the trusted binary and never consults the repository', async () => {
      const { command, args } = readLinkServer();

      await execFileAsync(command, args, {
        cwd: repoDir,
        timeout: 20_000,
        env: {
          HOME: tmpDir,
          // Node's directory is included so a package-runner config would
          // genuinely resolve and hit the repository's registry.
          PATH: [
            trustedDir,
            path.dirname(process.execPath),
            '/usr/bin',
            '/bin',
          ].join(path.delimiter),
        },
      }).catch(() => {});

      expect(fs.existsSync(path.join(tmpDir, 'trusted-marker'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'repo-marker'))).toBe(false);
      expect(registryRequests).toBe(0);
    }, 30_000);
  },
);
