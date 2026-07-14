import type { AuthStorage, ISpendRequestResource } from '@stripe/link-sdk';
import { Cli, z } from 'incur';
import React from 'react';
import { renderInteractive } from '../../utils/render-interactive';
import { requireAuth } from '../../utils/require-auth';
import { decodeStripeChallenge } from './decode';
import { DecodeChallengeView } from './decode-view';
import { MppInspect, type InspectResult, runMppInspect } from './inspect';
import { MppPay, type PayResult, runMppPay } from './pay';
import { decodeOptions, inspectOptions, payOptions } from './schema';

export function createMppCli(
  repository: ISpendRequestResource,
  authStorage?: AuthStorage,
  envAccessToken?: string,
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
    middleware: [requireAuth(authStorage, envAccessToken)],
    async run(c) {
      const url = c.args.url;
      const opts = c.options;
      const method = opts.method;
      const data = opts.data;
      const headers = opts.header?.length ? opts.header : undefined;

      if (!c.agent && !c.formatExplicit) {
        let capturedResult: PayResult | null = null;
        return renderInteractive(
          <MppPay
            url={url}
            spendRequestId={opts.spendRequestId}
            method={method}
            data={data}
            headers={headers}
            repository={repository}
            onComplete={(result) => {
              capturedResult = result;
            }}
          />,
          () => {
            if (!capturedResult)
              throw new Error('Component exited without producing a result');
            return capturedResult;
          },
        );
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
        return renderInteractive(
          <DecodeChallengeView decoded={decoded} />,
          () => decoded,
        );
      }

      return decoded;
    },
  });

  cli.command('inspect', {
    description:
      'Probe a URL and parse the WWW-Authenticate challenge to extract network_id and payment details',
    args: z.object({
      url: z.string().describe('URL to inspect'),
    }),
    options: inspectOptions,
    alias: { method: 'X', data: 'd', header: 'H' },
    outputPolicy: 'agent-only' as const,
    async run(c) {
      const url = c.args.url;
      const opts = c.options;
      const method = opts.method;
      const data = opts.data;
      const headers = opts.header?.length ? opts.header : undefined;

      if (!c.agent && !c.formatExplicit) {
        let capturedResult: InspectResult | null = null;
        return renderInteractive(
          <MppInspect
            url={url}
            method={method}
            data={data}
            headers={headers}
            onComplete={(result) => {
              capturedResult = result;
            }}
          />,
          () => {
            if (!capturedResult)
              throw new Error('Component exited without producing a result');
            return capturedResult;
          },
        );
      }

      return runMppInspect(url, method, data, headers);
    },
  });

  return cli;
}
