import { execFile } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const REPO_ROOT = new URL('../../../../../', import.meta.url).pathname;
const MCP_CONFIG_PATH = path.join(REPO_ROOT, '.mcp.json');
const FIXTURE_DIR = new URL('./fixtures/repo-controlled-npm/', import.meta.url)
  .pathname;

interface McpServerConfig {
  command: string;
  args: string[];
}

function readJson(file: string) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readLinkServer(): McpServerConfig {
  return readJson(MCP_CONFIG_PATH).mcpServers.link;
}

function resolvePluginMcpConfig(pluginDir: string, manifest: string) {
  const { mcpServers } = readJson(path.join(pluginDir, manifest));
  return fs.realpathSync(path.resolve(pluginDir, mcpServers));
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

  it('is the config published by the Claude marketplace', () => {
    const marketplace = readJson(
      path.join(REPO_ROOT, '.claude-plugin/marketplace.json'),
    );
    const link = marketplace.plugins.find(
      (plugin: { name: string }) => plugin.name === 'link',
    );

    expect(
      resolvePluginMcpConfig(
        path.resolve(REPO_ROOT, link.source),
        '.claude-plugin/plugin.json',
      ),
    ).toBe(fs.realpathSync(MCP_CONFIG_PATH));
  });

  it('is the config published by the Codex marketplaces', () => {
    const marketplace = readJson(
      path.join(REPO_ROOT, '.agents/plugins/marketplace.json'),
    );
    const link = marketplace.plugins.find(
      (plugin: { name: string }) => plugin.name === 'link',
    );

    expect(
      resolvePluginMcpConfig(
        path.resolve(REPO_ROOT, link.source.path),
        '.codex-plugin/plugin.json',
      ),
    ).toBe(fs.realpathSync(MCP_CONFIG_PATH));
    expect(resolvePluginMcpConfig(REPO_ROOT, '.codex-plugin/plugin.json')).toBe(
      fs.realpathSync(MCP_CONFIG_PATH),
    );
  });
});

// Reproduces both routes from the SAT-32137 report: a repository .npmrc that
// redirects package resolution, and a repository-local @stripe/link-cli.
describe.skipIf(process.platform === 'win32')(
  'plugin MCP startup from an untrusted repository',
  () => {
    let tmpDir: string;
    let repoDir: string;
    let trustedDir: string;
    let registry: net.Server;
    let registryConnections: number;

    beforeEach(async () => {
      // Count raw connections so TLS handshakes to the registry are caught too.
      registryConnections = 0;
      registry = net.createServer((socket) => {
        registryConnections++;
        socket.destroy();
      });
      await new Promise<void>((resolve) =>
        registry.listen(0, '127.0.0.1', resolve),
      );
      const { port } = registry.address() as net.AddressInfo;

      tmpDir = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), 'link-mcp-security-')),
      );
      repoDir = path.join(tmpDir, 'repo');
      trustedDir = path.join(tmpDir, 'trusted');
      fs.mkdirSync(repoDir);
      fs.mkdirSync(trustedDir);

      fs.writeFileSync(
        path.join(repoDir, '.npmrc'),
        fs
          .readFileSync(path.join(FIXTURE_DIR, 'npmrc.template'), 'utf8')
          .replaceAll('{{REGISTRY}}', `http://127.0.0.1:${port}/`),
      );
      fs.writeFileSync(
        path.join(trustedDir, 'link-cli'),
        '#!/bin/sh\necho "$0" >> "$LINK_TEST_MARKER_DIR/trusted-marker"\n',
        { mode: 0o755 },
      );
    });

    afterEach(async () => {
      await new Promise((resolve) => registry?.close(resolve));
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function installRepositoryPackage() {
      const pkgDir = path.join(repoDir, 'node_modules/@stripe/link-cli');
      fs.cpSync(path.join(FIXTURE_DIR, 'local-package'), pkgDir, {
        recursive: true,
      });
      fs.mkdirSync(path.join(repoDir, 'node_modules/.bin'));
      fs.symlinkSync(
        '../@stripe/link-cli/bin.sh',
        path.join(repoDir, 'node_modules/.bin/link-cli'),
      );
    }

    async function launchCheckedInConfig() {
      const { command, args } = readLinkServer();
      await execFileAsync(command, args, {
        cwd: repoDir,
        timeout: 20_000,
        env: {
          HOME: tmpDir,
          LINK_TEST_MARKER_DIR: tmpDir,
          // Node's directory is included so a package-runner config would
          // genuinely resolve and reach the repository's registry or package.
          PATH: [
            trustedDir,
            path.dirname(process.execPath),
            '/usr/bin',
            '/bin',
          ].join(path.delimiter),
        },
      }).catch(() => {});
    }

    function expectTrustedBinaryOnly() {
      expect(fs.existsSync(path.join(tmpDir, 'trusted-marker'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'repo-marker'))).toBe(false);
      expect(registryConnections).toBe(0);
    }

    it('ignores a repository .npmrc registry override', async () => {
      await launchCheckedInConfig();

      expectTrustedBinaryOnly();
    }, 30_000);

    it('ignores a repository-local @stripe/link-cli package', async () => {
      installRepositoryPackage();

      await launchCheckedInConfig();

      expectTrustedBinaryOnly();
    }, 30_000);
  },
);
