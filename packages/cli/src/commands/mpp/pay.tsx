import type {
  IPaymentMethodsResource,
  ISpendRequestResource,
  SpendRequest,
} from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { Challenge, Credential, Expires, Method } from 'mppx';
import { Mppx, Transport } from 'mppx/client';
import { Methods as StripeMethods } from 'mppx/stripe';
import React, { useEffect, useState } from 'react';
import { isAddress } from 'viem';
import { pollUntilApproved } from '../../utils/poll-until-approved';
import { sanitizeDeep } from '../../utils/sanitize-text';
import {
  decodeStripeChallenge,
  getStripeChargeChallengeFromResponse,
} from './decode';

export type PayResult = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

export interface TempoChargeRequest {
  amount: string;
  currency: string;
  decimals: number;
  chainId?: number;
  recipient?: string;
  feePayer?: boolean;
  splits?: Array<{ amount: string; recipient: string; memo?: string }>;
  supportedModes?: Array<'push' | 'pull'>;
}

export interface ResolvedTempoChallenge {
  challenge: Challenge.Challenge;
  request: TempoChargeRequest & {
    chainId: number;
    recipient: string;
  };
}

declare const __CLI_VERSION__: string;

export function buildHeaders(
  data: string | undefined,
  headers: string[] | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (data !== undefined) {
    result['Content-Type'] = 'application/json';
  }
  for (const line of headers ?? []) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) result[key] = value;
  }
  if (!Object.keys(result).some((key) => key.toLowerCase() === 'user-agent')) {
    result['User-Agent'] = `link-cli/${__CLI_VERSION__}`;
  }
  return result;
}

export async function readPayResult(response: Response): Promise<PayResult> {
  const responseHeaders = Object.fromEntries(response.headers.entries());
  const body = await response.text();
  // Response body and headers are fully attacker-controlled. Strip ANSI escape
  // sequences and control characters so they cannot spoof the terminal UI or
  // inject content into the agent's context. See CLAUDE.md security note.
  return sanitizeDeep({
    status: response.status,
    headers: responseHeaders,
    body,
  });
}

const SUPPORTED_TEMPO_CHAIN_IDS = new Set([4217, 42431]);

export function resolveTempoChallenge(
  challengeHeader: string,
): ResolvedTempoChallenge {
  const challenges = Challenge.deserializeList(challengeHeader);
  const challenge = challenges.find(
    (candidate) =>
      candidate.method === 'tempo' && candidate.intent === 'charge',
  );

  if (!challenge) {
    const unsupportedTempo = challenges.find(
      (candidate) => candidate.method === 'tempo',
    );
    if (unsupportedTempo) {
      throw new Error(
        `Unsupported Tempo intent '${unsupportedTempo.intent}'. This PoC supports charge only.`,
      );
    }
    throw new Error(
      'WWW-Authenticate header does not include a supported stripe or tempo charge challenge',
    );
  }

  Expires.assert(challenge.expires, challenge.id);
  const rawRequest = challenge.request;
  const methodDetails =
    rawRequest.methodDetails &&
    typeof rawRequest.methodDetails === 'object' &&
    !Array.isArray(rawRequest.methodDetails)
      ? (rawRequest.methodDetails as Record<string, unknown>)
      : {};
  if (
    typeof rawRequest.amount !== 'string' ||
    !/^\d+$/.test(rawRequest.amount)
  ) {
    throw new Error('Tempo charge amount must be an atomic integer string.');
  }
  if (typeof rawRequest.currency !== 'string') {
    throw new Error('Tempo charge currency must be a token address.');
  }
  if (
    rawRequest.recipient !== undefined &&
    typeof rawRequest.recipient !== 'string'
  ) {
    throw new Error('Tempo charge recipient must be an address.');
  }
  if (
    methodDetails.chainId !== undefined &&
    typeof methodDetails.chainId !== 'number'
  ) {
    throw new Error('Tempo charge chain ID must be a number.');
  }
  if (
    methodDetails.supportedModes !== undefined &&
    (!Array.isArray(methodDetails.supportedModes) ||
      !methodDetails.supportedModes.every(
        (mode) => mode === 'push' || mode === 'pull',
      ))
  ) {
    throw new Error('Tempo charge supported modes are invalid.');
  }
  if (
    methodDetails.splits !== undefined &&
    !Array.isArray(methodDetails.splits)
  ) {
    throw new Error('Tempo charge splits are invalid.');
  }

  const request: TempoChargeRequest = {
    amount: rawRequest.amount,
    currency: rawRequest.currency,
    // TIP-20 stablecoins use six decimals. MPP carries atomic amounts on wire.
    decimals: 6,
    chainId: methodDetails.chainId as number | undefined,
    recipient: rawRequest.recipient as string | undefined,
    feePayer: methodDetails.feePayer as boolean | undefined,
    splits: methodDetails.splits as TempoChargeRequest['splits'],
    supportedModes:
      methodDetails.supportedModes as TempoChargeRequest['supportedModes'],
  };

  if (!request.chainId || !SUPPORTED_TEMPO_CHAIN_IDS.has(request.chainId)) {
    throw new Error(
      `Unsupported Tempo chain ID '${request.chainId ?? 'missing'}'. Expected 4217 or 42431.`,
    );
  }
  if (BigInt(request.amount) <= 0n) {
    throw new Error('Tempo charge amount must be greater than zero.');
  }
  if (!isAddress(request.currency)) {
    throw new Error('Tempo charge currency must be a valid token address.');
  }
  if (!request.recipient || !isAddress(request.recipient)) {
    throw new Error('Tempo charge recipient must be a valid address.');
  }
  if (request.splits?.length) {
    throw new Error('Tempo split payments are not supported by this PoC.');
  }
  if (request.supportedModes && !request.supportedModes.includes('pull')) {
    throw new Error('Tempo challenge does not support pull mode.');
  }

  return {
    challenge,
    request: request as ResolvedTempoChallenge['request'],
  };
}

export function hasStripeChallenge(challengeHeader: string): boolean {
  return Challenge.deserializeList(challengeHeader).some(
    (challenge) =>
      challenge.method === 'stripe' &&
      (challenge.intent === 'charge' || challenge.intent === 'session'),
  );
}

export function assertTempoCompatibleOptions(options: {
  amountOverride?: number;
  paymentMethodId?: string;
  test?: boolean;
}) {
  if (options.amountOverride !== undefined) {
    throw new Error(
      '--amount cannot override a Tempo challenge; the exact challenged amount is signed.',
    );
  }
  if (options.paymentMethodId !== undefined) {
    throw new Error(
      '--payment-method-id is only supported for Stripe payments.',
    );
  }
  if (options.test) {
    throw new Error(
      '--test is only supported for Stripe payments; Tempo test mode is determined by the Link backend.',
    );
  }
}

export function buildSignedTransactionCredential(
  spendRequest: SpendRequest,
): string {
  const transaction = spendRequest.signed_transaction;
  if (!transaction) {
    throw new Error('Spend request does not have a signed transaction');
  }
  if (!spendRequest.payment_challenge) {
    throw new Error(
      'Spend request does not have its original payment challenge',
    );
  }
  const { challenge, request } = resolveTempoChallenge(
    spendRequest.payment_challenge,
  );
  const expectedPrefix = request.feePayer ? '78' : '76';
  if (
    !new RegExp(`^0x${expectedPrefix}[0-9a-f]+$`, 'i').test(
      transaction.tx_hash,
    ) ||
    transaction.tx_hash.length % 2 !== 0
  ) {
    throw new Error(
      `Spend request signed_transaction.tx_hash must be a serialized ${
        request.feePayer ? 'sponsored ' : ''
      }Tempo transaction (0x${expectedPrefix}-prefixed hex).`,
    );
  }

  return Credential.serialize({
    challenge,
    payload: { signature: transaction.tx_hash, type: 'transaction' },
  });
}

export async function payWithSignedTransaction(
  url: string,
  spendRequest: SpendRequest,
  method: string | undefined,
  data: string | undefined,
  headers: string[] | undefined,
): Promise<PayResult> {
  const httpMethod = method ?? (data !== undefined ? 'POST' : 'GET');
  const credential = buildSignedTransactionCredential(spendRequest);
  const response = await fetch(url, {
    method: httpMethod,
    body: data,
    headers: {
      ...buildHeaders(data, headers),
      Authorization: credential,
    },
  });
  return readPayResult(response);
}

function createStripePaymentClient(spt: string) {
  const stripeCharge = Method.toClient(StripeMethods.charge, {
    async createCredential({ challenge }) {
      return Credential.serialize({
        challenge,
        payload: { spt },
      });
    },
  });

  const stripeSession = Method.toClient(
    { ...StripeMethods.charge, intent: 'session' as const },
    {
      async createCredential({ challenge }) {
        return Credential.serialize({
          challenge,
          payload: { action: 'open', grantedToken: spt },
        });
      },
    },
  );

  return Mppx.create({
    methods: [stripeCharge, stripeSession],
    polyfill: false,
    transport: Transport.from<RequestInit, Response>({
      name: 'stripe-http',
      isPaymentRequired(response) {
        return response.status === 402;
      },
      getChallenge(response) {
        return getStripeChargeChallengeFromResponse(response);
      },
      setCredential(request, credential) {
        const nextHeaders = new Headers(request.headers);
        nextHeaders.set('Authorization', credential);
        return { ...request, headers: nextHeaders };
      },
    }),
  });
}

export interface MppPayFullFlowOptions {
  url: string;
  method: string | undefined;
  data: string | undefined;
  headers: string[] | undefined;
  context: string;
  amountOverride: number | undefined;
  paymentMethodId: string | undefined;
  test: boolean;
  repository: ISpendRequestResource;
  paymentMethodsFactory: () => IPaymentMethodsResource;
  onStep?: (step: Step) => void;
  onApprovalUrl?: (url: string) => void;
}

export async function runMppPayWithSpendRequest(
  url: string,
  spendRequestId: string,
  method: string | undefined,
  data: string | undefined,
  headers: string[] | undefined,
  repository: ISpendRequestResource,
): Promise<PayResult> {
  const spendRequest = await repository.retrieve(spendRequestId, {
    include: ['shared_payment_token', 'signed_transaction'],
  });

  if (!spendRequest) {
    throw new Error(`Spend request ${spendRequestId} not found`);
  }
  if (
    spendRequest.credential_type !== 'shared_payment_token' &&
    spendRequest.credential_type !== 'signed_transaction'
  ) {
    const type = spendRequest.credential_type ?? 'card';
    throw new Error(
      `Spend request ${spendRequestId} must have credential_type 'shared_payment_token' or 'signed_transaction' (current: '${type}')`,
    );
  }
  if (spendRequest.status !== 'approved') {
    throw new Error(
      `Spend request must be approved (current status: ${spendRequest.status})`,
    );
  }
  if (spendRequest.credential_type === 'signed_transaction') {
    return payWithSignedTransaction(url, spendRequest, method, data, headers);
  }
  if (!spendRequest.shared_payment_token) {
    throw new Error('Spend request does not have a shared payment token');
  }

  return payWithSpt(
    url,
    spendRequest.shared_payment_token.id,
    method,
    data,
    headers,
  );
}

export async function payWithSpt(
  url: string,
  spt: string,
  method: string | undefined,
  data: string | undefined,
  headers: string[] | undefined,
): Promise<PayResult> {
  const httpMethod = method ?? (data !== undefined ? 'POST' : 'GET');
  const requestHeaders = buildHeaders(data, headers);

  const initialResponse = await fetch(url, {
    method: httpMethod,
    body: data,
    headers: requestHeaders,
  });

  if (initialResponse.status !== 402) {
    return readPayResult(initialResponse);
  }

  const authHeader =
    await createStripePaymentClient(spt).createCredential(initialResponse);

  const retryResponse = await fetch(url, {
    method: httpMethod,
    body: data,
    headers: {
      ...requestHeaders,
      Authorization: authHeader,
    },
  });

  return readPayResult(retryResponse);
}

export async function runMppPayFullFlow(
  opts: MppPayFullFlowOptions,
): Promise<PayResult> {
  const {
    url,
    method,
    data,
    headers,
    context,
    amountOverride,
    paymentMethodId,
    test,
    repository,
    paymentMethodsFactory,
    onStep,
    onApprovalUrl,
  } = opts;

  const httpMethod = method ?? (data !== undefined ? 'POST' : 'GET');
  const requestHeaders = buildHeaders(data, headers);

  // 1. Probe URL
  onStep?.('probing');
  const probeResponse = await fetch(url, {
    method: httpMethod,
    body: data,
    headers: requestHeaders,
  });

  if (probeResponse.status !== 402) {
    return readPayResult(probeResponse);
  }

  // 2. Parse challenge
  const wwwAuth = probeResponse.headers.get('www-authenticate');
  if (!wwwAuth) {
    throw new Error('URL returned 402 but no WWW-Authenticate header');
  }

  if (!hasStripeChallenge(wwwAuth)) {
    assertTempoCompatibleOptions({ amountOverride, paymentMethodId, test });
    resolveTempoChallenge(wwwAuth);

    onStep?.('creating');
    const spendRequest = await repository.create({
      credential_type: 'signed_transaction',
      payment_challenge: wwwAuth,
      context,
      request_approval: true,
    });

    onStep?.('approving');
    if (spendRequest.approval_url) {
      onApprovalUrl?.(spendRequest.approval_url);
    }
    const approved = await pollUntilApproved(repository, spendRequest.id);
    if (approved.status !== 'approved') {
      throw new Error(
        `Spend request was not approved (status: ${approved.status})`,
      );
    }

    onStep?.('signing');
    let withTransaction = await repository.retrieve(spendRequest.id, {
      include: ['signed_transaction'],
    });
    for (
      let i = 0;
      i < 3 && withTransaction && !withTransaction.signed_transaction;
      i++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      withTransaction = await repository.retrieve(spendRequest.id, {
        include: ['signed_transaction'],
      });
    }
    if (!withTransaction?.signed_transaction) {
      throw new Error('Failed to retrieve signed transaction');
    }

    onStep?.('submitting');
    return payWithSignedTransaction(
      url,
      withTransaction,
      method,
      data,
      headers,
    );
  }

  const decoded = decodeStripeChallenge(wwwAuth);
  const networkId = decoded.network_id;
  const challengeAmount = decoded.request_json.amount
    ? Number(decoded.request_json.amount)
    : undefined;
  const challengeCurrency = (decoded.request_json.currency as string) ?? 'usd';

  const amount = amountOverride ?? challengeAmount;
  if (!amount) {
    throw new Error(
      'Could not determine amount from 402 challenge. Pass --amount explicitly.',
    );
  }

  // 3. Get payment method
  let pmId = paymentMethodId;
  if (!pmId) {
    onStep?.('creating');
    const pmResource = paymentMethodsFactory();
    const methods = await pmResource.list();
    if (!methods.length) {
      throw new Error(
        'No payment methods found. Add one with `link-cli payment-methods add`.',
      );
    }
    pmId = methods[0].id;
  }

  // 4. Create spend request
  onStep?.('creating');
  const spendRequest = await repository.create({
    payment_details: pmId,
    credential_type: 'shared_payment_token',
    network_id: networkId,
    amount,
    currency: challengeCurrency,
    context,
    request_approval: true,
    test: test || undefined,
  });

  // 5. Poll for approval
  onStep?.('approving');
  if (spendRequest.approval_url) {
    onApprovalUrl?.(spendRequest.approval_url);
  }

  const approved = await pollUntilApproved(repository, spendRequest.id);
  if (approved.status !== 'approved') {
    throw new Error(
      `Spend request was not approved (status: ${approved.status})`,
    );
  }

  // 6. Retrieve with SPT (retry briefly in case of propagation delay)
  onStep?.('signing');
  let withSpt = await repository.retrieve(spendRequest.id, {
    include: ['shared_payment_token'],
  });
  for (let i = 0; i < 3 && withSpt && !withSpt.shared_payment_token; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    withSpt = await repository.retrieve(spendRequest.id, {
      include: ['shared_payment_token'],
    });
  }
  if (!withSpt?.shared_payment_token) {
    throw new Error('Failed to retrieve shared payment token');
  }

  // 7. Pay
  onStep?.('submitting');
  return payWithSpt(
    url,
    withSpt.shared_payment_token.id,
    method,
    data,
    headers,
  );
}

export type Step =
  | 'probing'
  | 'creating'
  | 'approving'
  | 'signing'
  | 'submitting'
  | 'done';

export function MppPay({
  url,
  spendRequestId,
  method,
  data,
  headers,
  context,
  amountOverride,
  paymentMethodId,
  test,
  repository,
  paymentMethodsFactory,
  onComplete,
}: {
  url: string;
  spendRequestId?: string;
  method?: string;
  data?: string;
  headers?: string[];
  context?: string;
  amountOverride?: number;
  paymentMethodId?: string;
  test?: boolean;
  repository: ISpendRequestResource;
  paymentMethodsFactory: () => IPaymentMethodsResource;
  onComplete: (result: PayResult | null) => void;
}) {
  const [step, setStep] = useState<Step>(
    spendRequestId ? 'signing' : 'probing',
  );
  const [result, setResult] = useState<PayResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approvalUrl, setApprovalUrl] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        let payResult: PayResult;

        if (spendRequestId) {
          setStep('signing');
          payResult = await runMppPayWithSpendRequest(
            url,
            spendRequestId,
            method,
            data,
            headers,
            repository,
          );
        } else {
          if (!context) {
            throw new Error(
              '--context is required for the full MPP flow (min 100 chars)',
            );
          }
          payResult = await runMppPayFullFlow({
            url,
            method,
            data,
            headers,
            context,
            amountOverride,
            paymentMethodId,
            test: test ?? false,
            repository,
            paymentMethodsFactory,
            onStep: setStep,
            onApprovalUrl: (u) => setApprovalUrl(u),
          });
        }

        setResult(payResult);
        setStep('done');
        onComplete(payResult);
      } catch (err) {
        setError((err as Error).message);
        onComplete(null);
      }
    })();
  }, [
    url,
    spendRequestId,
    method,
    data,
    headers,
    context,
    amountOverride,
    paymentMethodId,
    test,
    repository,
    paymentMethodsFactory,
    onComplete,
  ]);

  const stepLabels: Record<Step, string> = {
    probing: 'Probing URL for 402 challenge',
    creating: 'Creating spend request',
    approving: 'Waiting for approval',
    signing: 'Signing credential',
    submitting: 'Submitting payment',
    done: 'Done',
  };

  if (error) {
    return <Text color="red">Error: {error}</Text>;
  }

  return (
    <Box flexDirection="column">
      {step !== 'done' && (
        <Box flexDirection="column">
          <Box>
            <Text color="cyan">
              <Spinner type="dots" /> {stepLabels[step]}...
            </Text>
          </Box>
          {step === 'approving' && approvalUrl && (
            <Box marginTop={1} paddingX={2}>
              <Text>
                Approve in Link app:{' '}
                <Text bold color="blue">
                  {approvalUrl}
                </Text>
              </Text>
            </Box>
          )}
        </Box>
      )}
      {result && (
        <Box flexDirection="column">
          <Text
            color={
              result.status >= 400
                ? 'red'
                : result.status >= 300
                  ? 'yellow'
                  : 'green'
            }
          >
            HTTP {result.status}
          </Text>
          <Text>{result.body}</Text>
        </Box>
      )}
    </Box>
  );
}
