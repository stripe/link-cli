// Keep signals, slugs, and priority aligned with Stripe CLI's DetectAIAgent:
// https://github.com/stripe/stripe-cli/blob/master/pkg/useragent/useragent.go
const agentSignals = [
  ['ANTIGRAVITY_CLI_ALIAS', 'antigravity'],
  ['CLAUDECODE', 'claude_code'],
  ['CLINE_ACTIVE', 'cline'],
  ['CODEX_SANDBOX', 'codex_cli'],
  ['CODEX_THREAD_ID', 'codex_cli'],
  ['CODEX_SANDBOX_NETWORK_DISABLED', 'codex_cli'],
  ['CODEX_CI', 'codex_cli'],
  ['CURSOR_AGENT', 'cursor'],
  ['GEMINI_CLI', 'gemini_cli'],
  ['OPENCODE', 'open_code'],
  ['OPENCLAW_SHELL', 'openclaw'],
  // Host signals are fallbacks after all agent-specific signals.
  ['CLAUDE_CODE_ENTRYPOINT', 'claude_code'],
  ['CODEX_INTERNAL_ORIGINATOR_OVERRIDE', 'codex_cli'],
] as const;

export function detectAIAgent(
  env: Readonly<Record<string, string | undefined>>,
): string {
  for (const [variable, agent] of agentSignals) {
    if (env[variable]) return agent;
  }
  return '';
}
