import type { IMppResource, ISpendRequestResource } from '@stripe/link-sdk';
import { Cli, z } from 'incur';
import type { CliAuthStorage } from '../../auth/storage';
import { buildCommandContinuation } from '../../utils/command-continuation';
import { renderInteractive } from '../../utils/render-interactive';
import { requireAuth } from '../../utils/require-auth';
import { sanitizeDeep, sanitizeText } from '../../utils/sanitize-text';
import { decodeStripeChallenge } from './decode';
import { DecodeChallengeView } from './decode-view';
import {
  buildHeaders,
  type CliMppResource,
  MppPay,
  type PayResult,
  runMppPayWithSpendRequest,
} from './pay';
import { decodeOptions, payOptions } from './schema';

export function resolveInteractivePayResult(
  result: PayResult | null | undefined,
): PayResult | undefined {
  if (result === undefined) {
    throw new Error('Component exited without producing a result');
  }
  if (result === null) {
    process.exitCode = 1;
    return undefined;
  }
  return result;
}

export function createMppCli(
  mpp: IMppResource,
  spendRequests: ISpendRequestResource,
  authStorage?: CliAuthStorage,
  envAccessToken?: string,
) {
  const cliMpp = mpp as CliMppResource;
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
        let capturedResult: PayResult | null | undefined;
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
            approve={opts.approve}
            mpp={cliMpp}
            spendRequests={spendRequests}
            onComplete={(result) => {
              capturedResult = result;
            }}
          />,
          () => resolveInteractivePayResult(capturedResult),
        );
      }

      if (opts.spendRequestId) {
        yield await runMppPayWithSpendRequest(
          url,
          opts.spendRequestId,
          method,
          data,
          headers,
          mpp,
          opts.approvedChallenge,
        );
        return;
      }

      // Agent mode returns a continuation so approval can span multiple runs.
      const requestHeaders = buildHeaders(data, headers);
      if (!opts.context) {
        return c.error({
          code: 'INVALID_INPUT',
          message:
            '--context is required for the full MPP flow (min 100 chars). Describe the purchase and rationale.',
        });
      }

      const prepared = await cliMpp.createSpendRequest({
        url,
        ...(method !== undefined && { method }),
        ...(data !== undefined && { body: data }),
        headers: requestHeaders,
        context: opts.context,
        ...(opts.amount !== undefined && { amount: opts.amount }),
        ...(opts.paymentMethodId !== undefined && {
          paymentMethodId: opts.paymentMethodId,
        }),
        test: opts.test,
        approve: opts.approve,
      });
      if (!('spendRequest' in prepared)) {
        yield sanitizeDeep(prepared);
        return;
      }
      const spendRequest = sanitizeDeep(prepared.spendRequest);
      const probe = prepared.request;
      const wwwAuth = sanitizeText(prepared.approvedChallenge);

      // Continue from the request that actually returned the challenge. Redirects
      // may have changed its URL, method, body, or safe-to-forward headers.
      // Merchant-controlled values remain data in the structured continuation.
      const nextArgs = [
        'pay',
        probe.url,
        '--spend-request-id',
        spendRequest.id,
        '--approved-challenge',
        wwwAuth,
        '-X',
        probe.method,
      ];
      if (probe.body !== undefined) nextArgs.push('-d', probe.body);
      for (const [name, value] of Object.entries(probe.headers)) {
        nextArgs.push('-H', `${name}: ${value}`);
      }
      const payment = buildCommandContinuation('mpp', nextArgs);
      const poll = buildCommandContinuation('spend-request', [
        'retrieve',
        spendRequest.id,
        '--interval',
        '2',
        '--max-attempts',
        '300',
      ]);

      // Yield approval URL and return — agent drives completion via _next
      yield {
        ...spendRequest,
        instruction:
          'Present the approval_url to the user and ask them to approve in the Link app. Then invoke _next.poll_argv directly without a shell to poll until approved. Once approved, invoke _next.pay_argv directly without a shell to complete payment. Do not wait for the user to reply — start polling immediately.',
        _next: {
          ...(payment.command !== undefined
            ? {
                poll_command: poll.command,
                pay_command: payment.command,
                shell: payment.shell,
              }
            : {}),
          poll_argv: poll.argv,
          pay_argv: payment.argv,
          until: 'status changes from pending_approval, then run pay_argv',
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
