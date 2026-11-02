import { realpathSync } from 'node:fs';

// Never emit a package runner (npx, pnpx, bunx): they honour the working
// directory's .npmrc and node_modules, letting an opened repository choose
// which executable starts the MCP server. Require the installed binary instead.
export function buildMcpCommand({
  entry = process.argv[1],
  executable = process.execPath,
}: {
  entry?: string;
  executable?: string;
} = {}) {
  let standalone = entry === executable;
  try {
    standalone = realpathSync(entry ?? '') === realpathSync(executable);
  } catch {}

  if (standalone) return `"${executable.replaceAll('"', '\\"')}" --mcp`;
  return 'link-cli --mcp';
}
