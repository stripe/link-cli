import type {
  IPaymentMethodsResource,
  ISpendRequestResource,
  SpendRequest,
} from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { Challenge, Credential, Expires, Method } from 'mppx';
import { Mppx } from 'mppx/client';
import { Methods as StripeMethods } from 'mppx/stripe';
import { Methods as TempoMethods, Proof as TempoProof } from 'mppx/tempo';
import { useEffect, useState } from 'react';
import { isAddress } from 'viem';
import { pollUntilApproved } from '../../utils/poll-until-approved';
import { sanitizeDeep } from '../../utils/sanitize-text';
import {
  decodeStripeChallenge,
  getStripeChargeChallengeFromHeader,
  getStripeChargeChallengeFromResponse,
} from './decode';
import {
  createMppRequest,
  createSafeMppFetch,
  fetchMppRequest,
  isRedirectResponse,
  type MppRequest,
} from './request';

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
  };
}

export interface ResolvedTempoSessionChallenge {
  challenge: Challenge.Challenge;
}

export interface MppProof {
  signature: string;
  source: string;
}

export interface IMppProofSigner {
  signMppProof(parameters: {
    challenge: Challenge.Challenge;
    chainId: number;
  }): Promise<MppProof>;
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
  if (!isAddress(request.currency)) {
    throw new Error('Tempo charge currency must be a valid token address.');
  }
  if (request.recipient && !isAddress(request.recipient)) {
    throw new Error('Tempo charge recipient must be a valid address.');
  }

  // A zero-amount charge is an identity proof, not a transaction. Recipient,
  // split-payment, and transaction-mode restrictions do not apply because no
  // funds move. Non-zero charges retain the PoC's pull-transaction limits.
  if (BigInt(request.amount) > 0n) {
    if (!request.recipient) {
      throw new Error('Tempo charge recipient must be a valid address.');
    }
    if (request.splits?.length) {
      throw new Error('Tempo split payments are not supported by this PoC.');
    }
    if (request.supportedModes && !request.supportedModes.includes('pull')) {
      throw new Error('Tempo challenge does not support pull mode.');
    }
  }

  return {
    challenge,
    request: request as ResolvedTempoChallenge['request'],
  };
}

export function resolveTempoSessionChallenge(
  challengeHeader: string,
): ResolvedTempoSessionChallenge {
  const challenge = Challenge.deserializeList(challengeHeader).find(
    (candidate) =>
      candidate.method === 'tempo' && candidate.intent === 'session',
  );
  if (!challenge) {
    throw new Error(
      'WWW-Authenticate header does not include a Tempo session challenge',
    );
  }
  Expires.assert(challenge.expires, challenge.id);
  return { challenge };
}

export function isTempoProofChallenge(
  resolved: ResolvedTempoChallenge,
): boolean {
  return BigInt(resolved.request.amount) === 0n;
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
  const source = (transaction as { source?: unknown }).source;
  if (source !== undefined) {
    if (typeof source !== 'string') {
      throw new Error(
        'Spend request signed_transaction.source must be a Tempo payer DID.',
      );
    }
    const payer = TempoProof.parseProofSource(source);
    if (!payer || payer.chainId !== request.chainId) {
      throw new Error(
        'Spend request signed_transaction.source must identify the challenged Tempo chain.',
      );
    }
  }
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
    ...(source ? { source } : {}),
  });
}

type ExperimentalPaymentAuthorization = {
  header_name: string;
  protocol: 'mpp';
  value: string;
};

/** Reads and verifies the local PoC's complete challenge-bound authorization. */
export function getExperimentalPaymentAuthorization(
  spendRequest: SpendRequest,
): string | undefined {
  const authorization = (
    spendRequest as SpendRequest & {
      payment_authorization?: ExperimentalPaymentAuthorization;
    }
  ).payment_authorization;
  if (!authorization) return undefined;
  if (
    authorization.protocol !== 'mpp' ||
    authorization.header_name.toLowerCase() !== 'authorization' ||
    typeof authorization.value !== 'string'
  ) {
    throw new Error('Spend request payment authorization is invalid.');
  }
  if (!spendRequest.payment_challenge) {
    throw new Error(
      'Spend request does not have its original payment challenge',
    );
  }

  const credential = Credential.deserialize(authorization.value);
  const original = Challenge.deserializeList(
    spendRequest.payment_challenge,
  ).find((challenge) => challenge.id === credential.challenge.id);
  if (
    !original ||
    Challenge.serialize(original) !== Challenge.serialize(credential.challenge)
  ) {
    throw new Error(
      'Spend request payment authorization does not match its original challenge.',
    );
  }
  return authorization.value;
}

export async function payWithSignedTransaction(
  url: string,
  spendRequest: SpendRequest,
  method: string | undefined,
  data: string | undefined,
  headers: string[] | undefined,
): Promise<PayResult> {
  const httpMethod = method ?? (data !== undefined ? 'POST' : 'GET');
  const credential =
    getExperimentalPaymentAuthorization(spendRequest) ??
    buildSignedTransactionCredential(spendRequest);
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

function createStripePaymentClient(
  spt?: string,
  fetcher: typeof fetch = fetch,
) {
  const tempoCharge = Method.toClient(TempoMethods.charge, {
    async createCredential() {
      throw new Error('A signed Tempo transaction is required to pay');
    },
  });
  const stripeCharge = Method.toClient(StripeMethods.charge, {
    async createCredential({ challenge }) {
      if (!spt) throw new Error('A shared payment token is required to pay');
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
        if (!spt) throw new Error('A shared payment token is required to pay');
        return Credential.serialize({
          challenge,
          payload: { action: 'open', grantedToken: spt },
        });
      },
    },
  );

  return Mppx.create({
    fetch: createSafeMppFetch(fetcher),
    methods: spt
      ? [stripeCharge, stripeSession]
      : [stripeCharge, stripeSession, tempoCharge],
    polyfill: false,
  });
}

export interface MppProbe extends MppRequest {
  response: Response;
}

export async function probeMppRequest(
  initial: MppRequest,
  fetcher: typeof fetch = fetch,
): Promise<MppProbe> {
  const prepared = await createStripePaymentClient(
    undefined,
    fetcher,
  ).prepareRequest(
    initial.url,
    {
      body: initial.body,
      headers: initial.headers,
      method: initial.method,
    },
    { maxRedirects: 10 },
  );
  const response = prepared.payment
    ? new Response(null, {
        headers: prepared.response.headers,
        status: prepared.response.status,
        statusText: prepared.response.statusText,
      })
    : prepared.response;
  if (prepared.payment) {
    void prepared.response.body?.cancel().catch(() => undefined);
  }
  const method = prepared.request.method;
  return {
    body: method === 'GET' || method === 'HEAD' ? undefined : initial.body,
    headers: new Headers(prepared.request.headers),
    method,
    response,
    url: prepared.request.url,
  };
}

function createTempoProofClient(signer: IMppProofSigner, chainId: number) {
  const tempoProof = Method.toClient(TempoMethods.charge, {
    async createCredential({ challenge }) {
      const proof = await signer.signMppProof({ challenge, chainId });
      const source = TempoProof.parseProofSource(proof.source);
      if (!source || source.chainId !== chainId) {
        throw new Error(
          'MPP proof source must identify the challenged Tempo chain.',
        );
      }
      if (!/^0x[0-9a-f]+$/i.test(proof.signature)) {
        throw new Error('MPP proof signer returned an invalid hex signature.');
      }
      return Credential.serialize({
        challenge,
        payload: { signature: proof.signature, type: 'proof' },
        source: proof.source,
      });
    },
  });

  return Mppx.create({ methods: [tempoProof], polyfill: false });
}

export interface MppProofOptions {
  url: string;
  method?: string;
  data?: string;
  headers?: string[];
  signer: IMppProofSigner;
  fetcher?: typeof fetch;
}

export async function submitMppProof(
  probe: MppProbe,
  signer: IMppProofSigner,
  fetcher: typeof fetch = fetch,
): Promise<PayResult> {
  const challengeHeader = probe.response.headers.get('www-authenticate');
  if (!challengeHeader) {
    await probe.response.body?.cancel();
    throw new Error('URL returned 402 but no WWW-Authenticate header');
  }
  await probe.response.body?.cancel();

  const resolved = resolveTempoChallenge(challengeHeader);
  if (!isTempoProofChallenge(resolved)) {
    throw new Error(
      'MPP proof requires a zero-dollar Tempo charge challenge (amount: "0").',
    );
  }

  const credentialResponse = new Response(null, {
    status: probe.response.status,
    statusText: probe.response.statusText,
    headers: probe.response.headers,
  });
  const payment = await createTempoProofClient(
    signer,
    resolved.request.chainId,
  ).preparePayment(credentialResponse);
  if (payment.challenge.id !== resolved.challenge.id) {
    throw new Error('MPP proof signer selected an unexpected challenge.');
  }
  const credential = await payment.createCredential();

  const response = await fetcher(probe.url, {
    ...payment.setCredential(
      {
        method: probe.method,
        headers: probe.headers,
        body: probe.body,
      },
      credential,
    ),
    redirect: 'manual',
  });
  if (isRedirectResponse(response)) {
    await response.body?.cancel();
    throw new Error(
      `Authenticated MPP request returned redirect ${response.status}; refusing to forward the proof credential`,
    );
  }
  return readPayResult(response);
}

export async function runMppProof({
  url,
  method,
  data,
  headers,
  signer,
  fetcher = fetch,
}: MppProofOptions): Promise<PayResult> {
  const httpMethod = method ?? (data !== undefined ? 'POST' : 'GET');
  const probe = await probeMppRequest(
    createMppRequest(url, httpMethod, data, buildHeaders(data, headers)),
    fetcher,
  );
  if (probe.response.status !== 402) return readPayResult(probe.response);
  return submitMppProof(probe, signer, fetcher);
}

export interface MppPayFullFlowOptions {
  url: string;
  method: string | undefined;
  data: string | undefined;
  headers: string[] | undefined;
  context: string | undefined;
  amountOverride: number | undefined;
  paymentMethodId: string | undefined;
  test: boolean;
  preferSession?: boolean;
  repository: ISpendRequestResource;
  paymentMethodsFactory: () => IPaymentMethodsResource;
  proofSigner?: IMppProofSigner;
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
  approvedChallengeHeader?: string,
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
    approvedChallengeHeader,
  );
}

export async function payWithSpt(
  url: string,
  spt: string,
  method: string | undefined,
  data: string | undefined,
  headers: string[] | undefined,
  approvedChallengeHeader?: string,
): Promise<PayResult> {
  const httpMethod = method ?? (data !== undefined ? 'POST' : 'GET');
  const requestHeaders = buildHeaders(data, headers);
  const approvedChallenge = approvedChallengeHeader
    ? getStripeChargeChallengeFromHeader(approvedChallengeHeader)
    : undefined;
  return payPinnedChallengeWithSpt(
    createMppRequest(url, httpMethod, data, requestHeaders),
    spt,
    approvedChallenge,
  );
}

async function submitMppPayment(
  challenge: MppProbe,
  spt: string,
): Promise<PayResult> {
  // Credential creation needs only the challenge status and headers. Keep the
  // untrusted response body out of signing and release its stream separately.
  const credentialResponse = new Response(null, {
    status: challenge.response.status,
    statusText: challenge.response.statusText,
    headers: challenge.response.headers,
  });
  const payment =
    await createStripePaymentClient(spt).preparePayment(credentialResponse);
  const credential = await payment.createCredential();
  await challenge.response.body?.cancel();

  const response = await fetch(challenge.url, {
    ...payment.setCredential(
      {
        method: challenge.method,
        headers: challenge.headers,
        body: challenge.body,
      },
      credential,
    ),
    redirect: 'manual',
  });
  if (isRedirectResponse(response)) {
    await response.body?.cancel();
    throw new Error(
      `Paid MPP request returned redirect ${response.status}; refusing to forward the payment credential`,
    );
  }
  return readPayResult(response);
}

async function payPinnedChallengeWithSpt(
  request: MppRequest,
  spt: string,
  approvedChallenge?: Challenge.Challenge,
): Promise<PayResult> {
  // Approved credentials may be used minutes later. Refresh the challenge at
  // the pinned destination, but never let that destination move afterward.
  const response = await fetchMppRequest(request);
  if (isRedirectResponse(response)) {
    await response.body?.cancel();
    throw new Error(
      `MPP challenge destination redirected with status ${response.status} after approval`,
    );
  }
  const refreshed = { ...request, response };
  if (response.status !== 402) return readPayResult(response);
  if (approvedChallenge) {
    let refreshedChallenge: Challenge.Challenge;
    try {
      refreshedChallenge = getStripeChargeChallengeFromResponse(response);
    } catch (error) {
      await response.body?.cancel();
      throw error;
    }
    if (
      comparableChallenge(refreshedChallenge) !==
      comparableChallenge(approvedChallenge)
    ) {
      await response.body?.cancel();
      throw new Error(
        'MPP challenge changed after approval; refusing to use the approved payment credential',
      );
    }
  }
  return submitMppPayment(refreshed, spt);
}

function comparableChallenge(challenge: Challenge.Challenge): string {
  return Challenge.serialize({
    ...challenge,
    id: 'approval-comparison',
    expires: undefined,
  });
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
    preferSession,
    repository,
    paymentMethodsFactory,
    proofSigner,
    onStep,
    onApprovalUrl,
  } = opts;

  const httpMethod = method ?? (data !== undefined ? 'POST' : 'GET');
  const requestHeaders = buildHeaders(data, headers);
  if (preferSession) {
    requestHeaders['Accept-Payment'] = 'tempo/session';
  }

  // 1. Probe URL
  onStep?.('probing');
  const probe = await probeMppRequest(
    createMppRequest(url, httpMethod, data, requestHeaders),
  );
  const probeResponse = probe.response;

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
    const sessionChallenge = preferSession
      ? resolveTempoSessionChallenge(wwwAuth)
      : undefined;
    const chargeChallenge = preferSession
      ? undefined
      : resolveTempoChallenge(wwwAuth);
    const selectedChallenge =
      sessionChallenge?.challenge ?? chargeChallenge!.challenge;

    if (chargeChallenge && isTempoProofChallenge(chargeChallenge)) {
      if (!proofSigner) {
        await probeResponse.body?.cancel();
        throw new Error(
          'The Link Wallet backend does not yet expose MPP proof credentials. Set LINK_MPP_LOCAL_PRIVY=1 to use the local Privy PoC.',
        );
      }
      onStep?.('signing');
      return submitMppProof(probe, proofSigner);
    }

    if (!context) {
      await probeResponse.body?.cancel();
      throw new Error(
        '--context is required for Tempo payments (min 100 chars). Describe the purchase and rationale.',
      );
    }

    onStep?.('creating');
    const spendRequest = await repository.create({
      credential_type: 'signed_transaction',
      payment_challenge: Challenge.serialize(selectedChallenge),
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
  const approvedChallenge = getStripeChargeChallengeFromResponse(probeResponse);
  await probeResponse.body?.cancel();
  const networkId = decoded.network_id;
  const challengeAmount = decoded.request_json.amount
    ? Number(decoded.request_json.amount)
    : undefined;
  const challengeCurrency = (decoded.request_json.currency as string) ?? 'usd';

  const amount = amountOverride ?? challengeAmount;
  if (
    amountOverride !== undefined &&
    challengeAmount !== undefined &&
    amountOverride !== challengeAmount
  ) {
    throw new Error(
      `--amount must match the MPP challenge amount (${challengeAmount})`,
    );
  }
  if (!amount) {
    throw new Error(
      'Could not determine amount from 402 challenge. Pass --amount explicitly.',
    );
  }
  if (!context) {
    throw new Error(
      '--context is required for the full MPP flow (min 100 chars). Describe the purchase and rationale.',
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
  return payPinnedChallengeWithSpt(
    probe,
    withSpt.shared_payment_token.id,
    approvedChallenge,
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
  preferSession,
  repository,
  paymentMethodsFactory,
  proofSigner,
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
  preferSession?: boolean;
  repository: ISpendRequestResource;
  paymentMethodsFactory: () => IPaymentMethodsResource;
  proofSigner?: IMppProofSigner;
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
          payResult = await runMppPayFullFlow({
            url,
            method,
            data,
            headers,
            context,
            amountOverride,
            paymentMethodId,
            test: test ?? false,
            preferSession,
            repository,
            paymentMethodsFactory,
            proofSigner,
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
    proofSigner,
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
