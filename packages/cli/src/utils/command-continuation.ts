import { posixShellCommand } from './shell-quote';

export interface CommandArgv {
  // A trusted Link CLI subcommand, not an executable name.
  command: 'mpp' | 'ucp' | 'spend-request' | 'auth';
  args: string[];
}

export interface CommandContinuation {
  argv: CommandArgv;
  command?: string;
  shell?: 'posix';
}

/** Preserve argument data everywhere; emit compatibility strings only for POSIX. */
// Strips the potentially unsafe raw `next._command` output for win32 platforms
export function buildCommandContinuation(
  command: CommandArgv['command'],
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): CommandContinuation {
  const argv: CommandArgv = { command, args: [...args] };
  return platform === 'win32'
    ? { argv }
    : {
        argv,
        command: posixShellCommand([command, ...args]),
        shell: 'posix',
      };
}

/** Windows suggestions are labeled argument data, never executable shell strings. */
export function formatCommandSuggestion(
  continuation: CommandContinuation,
): string {
  return (
    continuation.command ??
    `Link CLI arguments (invoke without a shell): ${JSON.stringify(continuation.argv)}`
  );
}
