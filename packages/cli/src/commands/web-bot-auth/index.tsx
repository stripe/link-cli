import type { AuthStorage, IWebBotAuthResource } from '@stripe/link-sdk';
import { Cli, z } from 'incur';
import React from 'react';
import { renderInteractive } from '../../utils/render-interactive';
import { requireAuth } from '../../utils/require-auth';
import { WebBotAuthSign } from './sign';

export function createWebBotAuthCli(
  createResource: () => IWebBotAuthResource,
  authStorage?: AuthStorage,
) {
  const cli = Cli.create('web-bot-auth', {
    description: 'Web Bot Auth commands for Cloudflare/Vercel bot verification',
  });

  cli.command('sign', {
    description:
      'Get Web Bot Auth signature headers for a URL. ' +
      'Attach the returned Signature and Signature-Input headers to ' +
      'outbound requests to the merchant site to bypass bot protection.',
    args: z.object({
      url: z
        .string()
        .describe('Merchant URL to sign (e.g. https://merchant.com/checkout)'),
    }),
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage)],
    async run(c) {
      const resource = createResource();
      const { url } = c.args;

      if (!c.agent && !c.formatExplicit) {
        return renderInteractive(
          <WebBotAuthSign
            resource={resource}
            url={url}
            onComplete={() => {}}
          />,
          () => resource.getHeaders(url),
        );
      }

      return resource.getHeaders(url);
    },
  });

  return cli;
}
