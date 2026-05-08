import type { AuthStorage, ISpendRequestResource } from '@stripe/link-sdk';
import { Cli, z } from 'incur';
import { render } from 'ink';
import React from 'react';
import { requireAuth } from '../../utils/require-auth';
import { decodeStripeChallenge } from './decode';
import { DecodeChallengeView } from './decode-view';
import { MppPay, runMppPay } from './pay';
import { decodeOptions, payOptions } from './schema';

export function createMppCli(
  repository: ISpendRequestResource,
  authStorage?: AuthStorage,
) {
  const cli = Cli.create('mpp', {
    description: 'Machine payment protocol (MPP) commands',
  });

  cli.command('pay', {
    description:
      'Complete a machine payment protocol (MPP) payment using an approved spend request',
    args: z.object({
      url: z.string().describe('URL to pay'),
    }),
    options: payOptions,
    alias: { method: 'X', data: 'd', header: 'H' },
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage)],
    async run(c) {
      const url = c.args.url;
      const opts = c.options;
      const method = opts.method;
      const data = opts.data;
      const headers = opts.header?.length ? opts.header : undefined;

      if (!c.agent && !c.formatExplicit) {
        return new Promise((resolve) => {
          const { waitUntilExit } = render(
            <MppPay
              url={url}
              spendRequestId={opts.spendRequestId}
              method={method}
              data={data}
              headers={headers}
              repository={repository}
              onComplete={() => {}}
            />,
          );
          waitUntilExit().then(async () => {
            resolve(
              await runMppPay(
                url,
                opts.spendRequestId,
                method,
                data,
                headers,
                repository,
              ),
            );
          });
        });
      }

      return runMppPay(
        url,
        opts.spendRequestId,
        method,
        data,
        headers,
        repository,
      );
    },
  });

  cli.command('decode', {
    description:
      'Decode a stripe WWW-Authenticate challenge and extract network_id',
    options: decodeOptions,
    outputPolicy: 'agent-only' as const,
    async run(c) {
      const decoded = decodeStripeChallenge(c.options.challenge);

      if (!c.agent && !c.formatExplicit) {
        return new Promise((resolve) => {
          const { waitUntilExit } = render(
            <DecodeChallengeView decoded={decoded} />,
          );
          waitUntilExit().then(() => resolve(decoded));
        });
      }

      return decoded;
    },
  });

  return cli;
}
