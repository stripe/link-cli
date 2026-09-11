import { realpathSync } from 'node:fs';
import { isSea } from 'node:sea';

function runnerFromHint(value: string) {
  if (value.includes('pnpm')) return 'pnpx';
  if (value.includes('bun')) return 'bunx';
  if (value.includes('npm')) return 'npx';
}

// Mirrors Incur's unexported detector because `mcp.command` replaces its default command.
export function detectPackageRunner(hints?: readonly string[]) {
  let resolvedHints = hints;
  if (!resolvedHints) {
    const userAgent = process.env.npm_config_user_agent ?? '';
    let entry = process.argv[1] ?? '';
    try {
      entry = realpathSync(entry);
    } catch {}

    resolvedHints = [
      /pnpm|bun/.test(userAgent) || userAgent.startsWith('npm/')
        ? userAgent
        : '',
      process.env.npm_execpath ?? '',
      /(?:\/\.pnpm\/|\\\.pnpm\\)/.test(entry)
        ? 'pnpm'
        : /(?:\/\.bun\/|\\bun\\)/.test(entry)
          ? 'bun'
          : '',
    ];
  }
  return resolvedHints.map(runnerFromHint).find(Boolean) ?? 'npx';
}

export function buildMcpCommand(
  packageName: string,
  version: string,
  {
    sea = isSea(),
    executable = process.execPath,
  }: {
    sea?: boolean;
    executable?: string;
  } = {},
) {
  if (sea) return `"${executable.replaceAll('"', '\\"')}" --mcp`;
  return `${detectPackageRunner()} ${packageName}@${version} --mcp`;
}
