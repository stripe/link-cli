import type { AuthStorage, IWebBotAuthResource } from '@stripe/link-sdk';
import { Cli, z } from 'incur';
import { requireAuth } from '../../utils/require-auth';

const signOptions = z.object({
  url: z.string().describe('Target URL (domain is extracted for signing)'),
});

export function createWebBotAuthCli(
  webBotAuth: IWebBotAuthResource,
  authStorage?: AuthStorage,
) {
  const cli = Cli.create('web-bot-auth', {
    description: 'Web Bot Auth signature commands',
  });

  cli.command('sign', {
    description:
      'Get HTTP signature headers to prove this is an authenticated Link agent. ' +
      'Returns Signature, Signature-Input, and Signature-Agent headers valid for ~5 minutes on the target host. ' +
      'Reuse the same headers for all requests to the same host within the window. ' +
      'Different subdomains (e.g., www.x.com vs api.x.com) require separate signatures.',
    options: signOptions,
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage)],
    async run(c) {
      const result = await webBotAuth.sign(c.options.url);
      return {
        Signature: result.signature,
        'Signature-Input': result.signature_input,
        'Signature-Agent': result.signature_agent,
        expires_at: result.expires_at,
        authority: result.authority,
      };
    },
  });

  return cli;
}
