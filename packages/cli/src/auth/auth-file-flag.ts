export const AUTH_FILE_FLAG = '--auth';

export interface AuthFileFlag {
  /** Credential file to use, or undefined for the default location. */
  path: string | undefined;
  /** Set when `--auth` was given without a path. */
  error?: string;
}

/**
 * Removes the global `--auth <path>` flag from `argv`, so incur never sees it,
 * and returns the credential file path: the flag's value, else `envPath`
 * (`LINK_AUTH_FILE`).
 *
 * `--auth` with no path after it, or followed by another flag, is an error.
 * Falling back to another credential file there would make a command such as
 * `auth logout --auth` act on exactly the session the caller meant to avoid.
 */
export function takeAuthFileFlag(
  argv: string[],
  envPath: string | undefined,
): AuthFileFlag {
  const index = argv.indexOf(AUTH_FILE_FLAG);
  if (index === -1) {
    return { path: envPath };
  }

  const value = argv[index + 1];
  if (value === undefined || value === '' || value.startsWith('-')) {
    argv.splice(index, value === '' ? 2 : 1);
    return {
      path: undefined,
      error: `Missing value for flag: ${AUTH_FILE_FLAG} (expected a credential file path; write ./-name for a path that starts with "-")`,
    };
  }

  argv.splice(index, 2);
  return { path: value };
}
