/**
 * Characters that are inert to a shell in unquoted argument position, so a
 * value made only of these can be emitted bare. Everything with meaning to a
 * shell is excluded: `$` and backticks (substitution), `;` `&` `|` (control
 * operators), `<` `>` (redirection), `*` `?` `[` (globbing), `{` `}` (brace
 * expansion), `~` (tilde expansion), `!` (history expansion), `#` (comment),
 * parentheses, backslash, quotes, and all whitespace.
 *
 * Note `=` is inert as an argument but marks a variable assignment in command
 * position (`FOO=bar cmd`), so never use the output as a command *name*.
 */
const SAFE_RE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/**
 * Encodes a single value for safe interpolation into a shell command string.
 *
 * Command strings the CLI emits for an agent to run (`instruction`,
 * `_next.command`, `_next.pay_command`) are shell-injection sinks: agents
 * commonly execute them via Bash, so an unquoted value there gives whoever
 * controls it command execution on the agent's host — even though the same
 * value was harmless as an argv entry. Merchant-derived URLs, request bodies
 * and headers all reach these strings, so every interpolated value must go
 * through this function. Text sanitization does not substitute for it: `$(…)`,
 * backticks and `;` are ordinary printable characters.
 *
 * Values made only of shell-inert characters (see `SAFE_RE`) are returned
 * as-is, purely so ordinary URLs and IDs stay readable. Everything else is
 * wrapped in single quotes, inside which a shell interprets nothing. An
 * embedded `'` would otherwise close that quote and escape, so each one
 * becomes `'\''` — close the quote, emit an escaped literal quote, reopen.
 *
 * Beware that naive `'${value}'` wrapping is NOT equivalent; it is the bug
 * this function exists to prevent.
 */
export function shellQuote(value: string): string {
  // Redundant with SAFE_RE (which requires one or more characters, so an empty
  // string already takes the quoting branch and yields `''`) but stated
  // explicitly: an empty argument must survive as `''`, not disappear.
  if (value === '') {
    return "''";
  }

  if (SAFE_RE.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Joins an argv list into a single shell-safe command string, quoting each
 * entry independently via {@link shellQuote}.
 *
 * Prefer handing callers the argv array itself (e.g. `_next.pay_argv`) so it
 * can be invoked without a shell at all — a list of arguments has no seam to
 * smuggle syntax through, while a string always does. Use this only for the
 * compatibility string alongside it.
 */
export function shellCommand(parts: readonly string[]): string {
  return parts.map(shellQuote).join(' ');
}
