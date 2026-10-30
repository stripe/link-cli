import type {
  IMppResource,
  IPaymentMethodsResource,
  ISpendRequestResource,
} from '@stripe/link-sdk';
import { Cli, z } from 'incur';
import type { CliAuthStorage } from '../../auth/storage';
import { buildCommandContinuation } from '../../utils/command-continuation';
import { renderInteractive } from '../../utils/render-interactive';
import { requireAuth } from '../../utils/require-auth';
import { sanitizeDeep } from '../../utils/sanitize-text';
import { decodeStripeChallenge } from './decode';
import { DecodeChallengeView } from './decode-view';
import {
  buildHeaders,
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
  paymentMethodsFactory: () => IPaymentMethodsResource,
  authStorage?: CliAuthStorage,
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
            useApprovalPolicy={opts.useApprovalPolicy}
            mpp={mpp}
            spendRequests={spendRequests}
            paymentMethodsFactory={paymentMethodsFactory}
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
        );
        return;
      }

      if (!opts.context) {
        return c.error({
          code: 'INVALID_INPUT',
          message:
            '--context is required for the full MPP flow (min 100 chars). Describe the purchase and rationale.',
        });
      }

      // Agent mode returns a continuation so approval can span multiple runs.
      const requestHeaders = buildHeaders(data, headers);
      const mppRequest = {
        url,
        ...(method !== undefined && { method }),
        ...(data !== undefined && { body: data }),
        headers: requestHeaders,
      };

      const decoded = await mpp.decode(mppRequest);
      if (!decoded.payment_required) {
        yield sanitizeDeep(decoded.response);
        return;
      }

      const challenge = decoded.challenges[0];
      if (!challenge) {
        return c.error({
          code: 'INVALID_RESPONSE',
          message:
            'WWW-Authenticate header does not include a supported stripe charge or session challenge',
        });
      }

      const networkId = challenge.network_id;
      const challengeAmount = challenge.request_json.amount
        ? Number(challenge.request_json.amount)
        : undefined;
      const challengeCurrency =
        (challenge.request_json.currency as string) ?? 'usd';
      const amount = opts.amount ?? challengeAmount;

      if (
        opts.amount !== undefined &&
        challengeAmount !== undefined &&
        opts.amount !== challengeAmount
      ) {
        return c.error({
          code: 'INVALID_INPUT',
          message: `--amount must match the MPP challenge amount (${challengeAmount})`,
        });
      }

      if (!amount) {
        return c.error({
          code: 'INVALID_INPUT',
          message:
            'Could not determine amount from 402 challenge. Pass --amount explicitly.',
        });
      }

      let paymentMethodId = opts.paymentMethodId;
      if (!paymentMethodId) {
        const methods = await paymentMethodsFactory().list();
        const paymentMethod = methods[0];
        if (!paymentMethod) {
          return c.error({
            code: 'NO_PAYMENT_METHOD',
            message:
              'No payment methods found. Add one with `link-cli payment-methods add`.',
          });
        }
        paymentMethodId = paymentMethod.id;
      }

      const spendRequest = await spendRequests.create({
        payment_details: paymentMethodId,
        credential_type: 'shared_payment_token',
        network_id: networkId,
        amount,
        currency: challengeCurrency,
        context: opts.context,
        request_approval: true,
        test: opts.test || undefined,
        approve: opts.approve || opts.useApprovalPolicy || undefined,
        use_approval_policy: opts.useApprovalPolicy || undefined,
      });

      // Continue from the exact request the agent provided. mpp.pay re-probes
      // it (following safe redirects) and verifies the fresh challenge against
      // this spend request's own terms, so the destination isn't pinned here.
      const nextArgs = [
        'pay',
        url,
        '--spend-request-id',
        spendRequest.id,
        '-X',
        mppRequest.method ?? (data !== undefined ? 'POST' : 'GET'),
      ];
      if (data !== undefined) nextArgs.push('-d', data);
      for (const [name, value] of requestHeaders) {
        nextArgs.push('-H', `${name}: ${value}`);
      }
      const payment = buildCommandContinuation('mpp', nextArgs);

      if (spendRequest.status === 'approved') {
        yield {
          ...spendRequest,
          instruction:
            'Invoke _next.pay_argv directly without a shell to complete payment.',
          _next: {
            ...(payment.command !== undefined
              ? { pay_command: payment.command, shell: payment.shell }
              : {}),
            pay_argv: payment.argv,
          },
        };
        return;
      }

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
