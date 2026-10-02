/**
 * Removes a retired flag (and its value) from argv in place so incur does not
 * reject it as unknown. Returns whether the flag was present, letting the
 * command explain what replaced it.
 */
export function stripRemovedFlag(argv: string[], flag: string): boolean {
  let found = false;
  for (let i = argv.length - 1; i >= 0; i--) {
    const token = argv[i];
    if (token.startsWith(`${flag}=`)) {
      argv.splice(i, 1);
      found = true;
    } else if (token === flag) {
      const next = argv[i + 1];
      argv.splice(i, next !== undefined && !next.startsWith('-') ? 2 : 1);
      found = true;
    }
  }
  return found;
}
