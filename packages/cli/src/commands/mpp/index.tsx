import type {
  AuthStorage,
  IPaymentMethodsResource,
  ISpendRequestResource,
} from '@stripe/link-sdk';
import { Cli, z } from 'incur';
import React from 'react';
import { renderInteractive } from '../../utils/render-interactive';
import { requireAuth } from '../../utils/require-auth';
import { decodeStripeChallenge } from './decode';
import { DecodeChallengeView } from './decode-view';
import {
  MppPay,
  type PayResult,
  buildHeaders,
  generateContext,
  readPayResult,
  runMppPayFullFlow,
  runMppPayWithSpendRequest,
} from './pay';
import { decodeOptions, payOptions } from './schema';

export function createMppCli(
  repository: ISpendRequestResource,
  paymentMethodsFactory: () => IPaymentMethodsResource,
  authStorage?: AuthStorage,
  envAccessToken?: string,
) {
  const cli = Cli.create('mpp', {
    description: 'Machine payment protocol (MPP) commands',
  });

  cli.command('pay', {
    description:
      'Pay a URL via the Machine Payment Protocol. Handles the full 402 flow: probes the URL, parses the challenge, creates a spend request, gets approval, and pays with the SPT. Pass --spend-request-id to skip creation and use a pre-approved spend request.',
    args: z.object({
      url: z.string().describe('URL to pay'),
    }),
    options: payOptions,
    alias: { method: 'X', data: 'd', header: 'H' },
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage, envAccessToken)],
    async *run(c) {
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
            context={opts.context}
            amountOverride={opts.amount}
            paymentMethodId={opts.paymentMethodId}
            test={opts.test}
            repository={repository}
            paymentMethodsFactory={paymentMethodsFactory}
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

      if (opts.spendRequestId) {
        yield await runMppPayWithSpendRequest(
          url,
          opts.spendRequestId,
          method,
          data,
          headers,
          repository,
        );
        return;
      }

      // Full flow in agent mode: yield approval URL mid-flow so the agent
      // can present it to the user while we poll for approval inline.
      const httpMethod = method ?? (data !== undefined ? 'POST' : 'GET');
      const requestHeaders = buildHeaders(data, headers);

      const probeResponse = await fetch(url, {
        method: httpMethod,
        body: data,
        headers: requestHeaders,
      });

      if (probeResponse.status !== 402) {
        yield await readPayResult(probeResponse);
        return;
      }

      const wwwAuth = probeResponse.headers.get('www-authenticate');
      if (!wwwAuth) {
        return c.error({
          code: 'INVALID_RESPONSE',
          message: 'URL returned 402 but no WWW-Authenticate header',
        });
      }

      const decoded = decodeStripeChallenge(wwwAuth);
      const networkId = decoded.network_id;
      const challengeAmount = decoded.request_json.amount
        ? Number(decoded.request_json.amount)
        : undefined;
      const challengeCurrency =
        (decoded.request_json.currency as string) ?? 'usd';
      const amount = opts.amount ?? challengeAmount;

      if (!amount) {
        return c.error({
          code: 'INVALID_INPUT',
          message:
            'Could not determine amount from 402 challenge. Pass --amount explicitly.',
        });
      }

      let pmId = opts.paymentMethodId;
      if (!pmId) {
        const pmResource = paymentMethodsFactory();
        const methods = await pmResource.list();
        if (!methods.length) {
          return c.error({
            code: 'NO_PAYMENT_METHOD',
            message:
              'No payment methods found. Add one with `link-cli payment-methods add`.',
          });
        }
        pmId = methods[0].id;
      }

      const spendContext =
        opts.context ?? generateContext(url, amount, challengeCurrency);
      const spendRequest = await repository.createSpendRequest({
        payment_details: pmId,
        credential_type: 'shared_payment_token',
        network_id: networkId,
        amount,
        currency: challengeCurrency,
        context: spendContext,
        request_approval: true,
        test: opts.test || undefined,
      });

      // Build the mpp pay command for _next with the spend request ID
      const nextFlags = [`--spend-request-id ${spendRequest.id}`];
      if (method) nextFlags.push(`-X ${method}`);
      if (data) nextFlags.push(`-d '${data}'`);
      if (headers) {
        for (const h of headers) nextFlags.push(`-H '${h}'`);
      }
      const nextCommand = `mpp pay ${url} ${nextFlags.join(' ')}`;

      // Yield approval URL and return — agent drives completion via _next
      yield {
        ...spendRequest,
        instruction: `Present the approval_url to the user and ask them to approve in the Link app. Then call \`spend-request retrieve ${spendRequest.id} --interval 2 --max-attempts 300\` to poll until approved. Once approved, run the _next.command to complete payment. Do not wait for the user to reply — start polling immediately.`,
        _next: {
          poll_command: `spend-request retrieve ${spendRequest.id} --interval 2 --max-attempts 300`,
          pay_command: nextCommand,
          until: 'status changes from pending_approval, then run pay_command',
        },
      };
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

  return cli;
}
