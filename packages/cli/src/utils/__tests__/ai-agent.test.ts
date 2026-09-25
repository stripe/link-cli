import { describe, expect, it } from 'vitest';
import { detectAIAgent } from '../ai-agent';

const signals = [
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
  ['CLAUDE_CODE_ENTRYPOINT', 'claude_code'],
  ['CODEX_INTERNAL_ORIGINATOR_OVERRIDE', 'codex_cli'],
] as const;

const emptyEnv = Object.fromEntries(signals.map(([key]) => [key, '']));

describe('detectAIAgent', () => {
  it('returns an empty string without a recognized signal', () => {
    expect(detectAIAgent({})).toBe('');
    expect(detectAIAgent({ UNKNOWN_AGENT: '1' })).toBe('');
    expect(detectAIAgent(emptyEnv)).toBe('');
  });

  it.each(signals)('detects %s as %s', (variable, agent) => {
    expect(detectAIAgent({ ...emptyEnv, [variable]: '1' })).toBe(agent);
  });

  it.each(signals)('ignores empty or missing %s', (variable) => {
    expect(detectAIAgent({ [variable]: '' })).toBe('');
    expect(detectAIAgent({ [variable]: undefined })).toBe('');
  });

  it.each(['0', 'false', ' ', 'private-thread-id'])(
    'treats %j as a presence signal and emits only the slug',
    (value) => {
      expect(detectAIAgent({ CODEX_THREAD_ID: value })).toBe('codex_cli');
    },
  );

  it.each(
    signals.map(([variable, agent], index) => ({ variable, agent, index })),
  )('prioritizes $variable over all later signals', ({ agent, index }) => {
    const env = Object.fromEntries(
      signals.slice(index).map(([variable]) => [variable, '1']),
    );
    expect(detectAIAgent(env)).toBe(agent);
  });
});
