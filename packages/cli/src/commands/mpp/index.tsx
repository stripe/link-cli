import type {
  IPaymentMethodsResource,
  ISpendRequestResource,
} from '@stripe/link-sdk';
import { Cli, z } from 'incur';
import { Challenge } from 'mppx';
import type { CliAuthStorage } from '../../auth/storage';
import { renderInteractive } from '../../utils/render-interactive';
import { requireAuth } from '../../utils/require-auth';
import { shellCommand, shellQuote } from '../../utils/shell-quote';
import { decodeStripeChallenge } from './decode';
import { DecodeChallengeView } from './decode-view';
import { LocalPrivyMppProofSigner } from './local-mpp-proof';
import { LocalPrivySignInWithXResource } from './local-sign-in-with-x';
import {
  isLocalPrivyMode,
  LocalSignedTransactionResource,
} from './local-signed-transaction';
import {
  assertTempoCompatibleOptions,
  buildHeaders,
  hasStripeChallenge,
  type IMppProofSigner,
  isTempoProofChallenge,
  MppPay,
  type PayResult,
  probeMppRequest,
  readPayResult,
  resolveTempoChallenge,
  resolveTempoSessionChallenge,
  runMppPayWithSpendRequest,
  runMppProof,
  submitMppProof,
} from './pay';
import { createMppRequest } from './request';
import {
  decodeOptions,
  payOptions,
  proofOptions,
  signInWithXOptions,
} from './schema';
import { runSignInWithX } from './sign-in-with-x';

export function createMppCli(
  repository: ISpendRequestResource,
  paymentMethodsFactory: () => IPaymentMethodsResource,
  authStorage?: CliAuthStorage,
  envAccessToken?: string,
  proofSignerOverride?: IMppProofSigner,
) {
  const localMode = isLocalPrivyMode();
  const proofSigner =
    proofSignerOverride ??
    (localMode ? new LocalPrivyMppProofSigner() : undefined);
  const paymentRepository = localMode
    ? new LocalSignedTransactionResource(repository)
    : repository;
  const cli = Cli.create('mpp', {
    description: 'Machine payment protocol (MPP) commands',
  });

  cli.command('pay', {
    description:
      'Fulfill an MPP challenge. Paid challenges use a Link spend request; zero-dollar Tempo challenges use a wallet proof without creating one.',
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

      if (opts.session && !localMode && !opts.spendRequestId) {
        return c.error({
          code: 'NOT_SUPPORTED',
          message:
            '--session is currently available only with LINK_MPP_LOCAL_PRIVY=1.',
        });
      }

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
            preferSession={opts.session}
            repository={paymentRepository}
            paymentMethodsFactory={paymentMethodsFactory}
            proofSigner={proofSigner}
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
          paymentRepository,
          opts.approvedChallenge,
        );
        return;
      }

      // Full flow in agent mode: yield approval URL mid-flow so the agent
      // can present it to the user while we poll for approval inline.
      const httpMethod = method ?? (data !== undefined ? 'POST' : 'GET');
      const requestHeaders = buildHeaders(data, headers);
      if (opts.session) {
        requestHeaders['Accept-Payment'] = 'tempo/session';
      }

      const probe = await probeMppRequest(
        createMppRequest(url, httpMethod, data, requestHeaders),
      );
      const probeResponse = probe.response;

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

      if (!hasStripeChallenge(wwwAuth)) {
        assertTempoCompatibleOptions({
          amountOverride: opts.amount,
          paymentMethodId: opts.paymentMethodId,
          test: opts.test,
        });
        const sessionChallenge = opts.session
          ? resolveTempoSessionChallenge(wwwAuth)
          : undefined;
        const chargeChallenge = opts.session
          ? undefined
          : resolveTempoChallenge(wwwAuth);
        const selectedChallenge =
          sessionChallenge?.challenge ?? chargeChallenge!.challenge;

        if (chargeChallenge && isTempoProofChallenge(chargeChallenge)) {
          if (!proofSigner) {
            await probeResponse.body?.cancel();
            return c.error({
              code: 'NOT_SUPPORTED',
              message:
                'The Link Wallet backend does not yet expose MPP proof credentials. Set LINK_MPP_LOCAL_PRIVY=1 to use the local Privy PoC.',
            });
          }
          yield await submitMppProof(probe, proofSigner);
          return;
        }

        if (!opts.context) {
          await probeResponse.body?.cancel();
          return c.error({
            code: 'INVALID_INPUT',
            message:
              '--context is required for Tempo payments (min 100 chars). Describe the purchase and rationale.',
          });
        }

        const spendRequest = await paymentRepository.create({
          credential_type: 'signed_transaction',
          payment_challenge: Challenge.serialize(selectedChallenge),
          context: opts.context,
          request_approval: true,
        });

        if (localMode) {
          yield await runMppPayWithSpendRequest(
            url,
            spendRequest.id,
            method,
            data,
            headers,
            paymentRepository,
          );
          return;
        }

        const nextArgs = ['pay', url, '--spend-request-id', spendRequest.id];
        if (method) nextArgs.push('-X', method);
        if (data) nextArgs.push('-d', data);
        if (headers) {
          for (const h of headers) nextArgs.push('-H', h);
        }
        const nextCommand = `mpp ${shellCommand(nextArgs)}`;
        const pollCommand = `spend-request retrieve ${shellQuote(spendRequest.id)} --interval 2 --max-attempts 300`;

        yield {
          ...spendRequest,
          instruction: `Present the approval_url to the user and ask them to approve in the Link app. Then call \`${pollCommand}\` to poll until approved. Once approved, run _next.pay_argv (preferred — invoke it directly without a shell) or _next.pay_command to submit the signed transaction. Do not wait for the user to reply — start polling immediately.`,
          _next: {
            poll_command: pollCommand,
            pay_command: nextCommand,
            pay_argv: { command: 'mpp', args: nextArgs },
            until: 'status changes from pending_approval, then run pay_argv',
          },
        };
        return;
      }

      const decoded = decodeStripeChallenge(wwwAuth);
      await probeResponse.body?.cancel();
      const networkId = decoded.network_id;
      const challengeAmount = decoded.request_json.amount
        ? Number(decoded.request_json.amount)
        : undefined;
      const challengeCurrency =
        (decoded.request_json.currency as string) ?? 'usd';
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

      if (!opts.context) {
        return c.error({
          code: 'INVALID_INPUT',
          message:
            '--context is required for the full MPP flow (min 100 chars). Describe the purchase and rationale.',
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

      const spendRequest = await paymentRepository.create({
        payment_details: pmId,
        credential_type: 'shared_payment_token',
        network_id: networkId,
        amount,
        currency: challengeCurrency,
        context: opts.context,
        request_approval: true,
        test: opts.test || undefined,
      });

      // Continue from the request that actually returned the challenge. Redirects
      // may have changed its URL, method, body, or safe-to-forward headers.
      // Merchant-controlled values stay shell-quoted in the display command.
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
      for (const [name, value] of probe.headers) {
        nextArgs.push('-H', `${name}: ${value}`);
      }
      const nextCommand = `mpp ${shellCommand(nextArgs)}`;
      const pollCommand = `spend-request retrieve ${shellQuote(spendRequest.id)} --interval 2 --max-attempts 300`;

      // Yield approval URL and return — agent drives completion via _next
      yield {
        ...spendRequest,
        instruction: `Present the approval_url to the user and ask them to approve in the Link app. Then call \`${pollCommand}\` to poll until approved. Once approved, run _next.pay_argv (preferred — invoke it directly without a shell) or _next.pay_command to complete payment. Do not wait for the user to reply — start polling immediately.`,
        _next: {
          poll_command: pollCommand,
          pay_command: nextCommand,
          pay_argv: { command: 'mpp', args: nextArgs },
          until: 'status changes from pending_approval, then run pay_argv',
        },
      };
    },
  });

  cli.command('proof', {
    description:
      'Satisfy a zero-dollar Tempo MPP identity challenge using the Link wallet, without creating a spend request.',
    args: z.object({
      url: z.string().describe('URL requiring zero-dollar MPP authentication'),
    }),
    options: proofOptions,
    alias: { method: 'X', data: 'd', header: 'H' },
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage, envAccessToken)],
    async run(c) {
      if (!proofSigner) {
        return c.error({
          code: 'NOT_SUPPORTED',
          message:
            'The Link Wallet backend does not yet expose MPP proof credentials. Set LINK_MPP_LOCAL_PRIVY=1 to use the local Privy PoC.',
        });
      }
      return runMppProof({
        url: c.args.url,
        method: c.options.method,
        data: c.options.data,
        headers: c.options.header?.length ? c.options.header : undefined,
        signer: proofSigner,
      });
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

  cli.command('sign-in-with-x', {
    description:
      'Satisfy an x402 Sign-In-With-X challenge using the wallet that paid for an MPP-enabled resource.',
    args: z.object({
      url: z.string().describe('URL requiring SIWX authentication'),
    }),
    options: signInWithXOptions,
    alias: { method: 'X', data: 'd', header: 'H' },
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage, envAccessToken)],
    async run(c) {
      if (!localMode) {
        return c.error({
          code: 'NOT_SUPPORTED',
          message:
            'The Link Wallet backend does not yet expose Sign-In-With-X credentials. Set LINK_MPP_LOCAL_PRIVY=1 to use the local Privy PoC.',
        });
      }
      return runSignInWithX({
        url: c.args.url,
        method: c.options.method,
        data: c.options.data,
        headers: c.options.header?.length ? c.options.header : undefined,
        credentialResource: new LocalPrivySignInWithXResource(),
      });
    },
  });

  return cli;
}
