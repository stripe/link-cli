import { detectAIAgent } from './ai-agent';

export function buildUserAgent(
  cliVersion: string,
  env: Readonly<Record<string, string | undefined>>,
): string {
  const agent = detectAIAgent(env);
  return `link-cli/${cliVersion}${agent ? ` AIAgent/${agent}` : ''}`;
}
