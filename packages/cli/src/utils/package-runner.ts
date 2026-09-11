import { realpathSync } from 'node:fs';

function runnerFromHint(value: string) {
  if (value.includes('pnpm')) return 'pnpx';
  if (value.includes('bun')) return 'bunx';
  if (value.includes('npm')) return 'npx';
}

// Mirrors Incur's unexported detector because `mcp.command` replaces its default command.
export function detectPackageRunner(hints?: readonly string[]) {
  if (!hints) {
    const userAgent = process.env.npm_config_user_agent ?? '';
    let entry = process.argv[1] ?? '';
    try {
      entry = realpathSync(entry);
    } catch {}

    hints = [
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
  return hints.map(runnerFromHint).find(Boolean) ?? 'npx';
}
