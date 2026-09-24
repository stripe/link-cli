import type {
  IPaymentMethodsResource,
  ISpendRequestResource,
} from '@stripe/link-sdk';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { Challenge, Credential, Method } from 'mppx';
import { Mppx } from 'mppx/client';
import { Methods as StripeMethods } from 'mppx/stripe';
import { useEffect, useState } from 'react';
import { openUrl } from '../../utils/open-url';
import { pollUntilApproved } from '../../utils/poll-until-approved';
import { sanitizeDeep } from '../../utils/sanitize-text';
import { takeAttestation } from '../attestations/storage';
import { presentIdentityCredential } from '../credentials/present';
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

function createStripePaymentClient(
  spt?: string,
  fetcher: typeof fetch = fetch,
) {
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
    methods: [stripeCharge, stripeSession],
    polyfill: false,
  });
}

export interface MppProbe extends MppRequest {
  response: Response;
}

export interface AapCredentialProvider {
  takeAttestation: typeof takeAttestation;
  presentIdentityCredential: typeof presentIdentityCredential;
}

const defaultAapCredentialProvider: AapCredentialProvider = {
  takeAttestation,
  presentIdentityCredential,
};

export interface PreparedMppProbe {
  probe: MppProbe;
  ephemeralHeaderNames: readonly string[];
}

type ClaimsChallenge = {
  aud: string;
  nonce: string;
  claims: string[];
};

function authenticationSchemes(header: string): Set<string> {
  const schemes = new Set<string>();
  let quoted = false;
  let escaped = false;
  let segmentStart = 0;

  const inspectSegment = (segment: string, first: boolean) => {
    const match = segment.trim().match(/^([^\s=,]+)(?:\s|$)/);
    if (!match) return;
    // The first segment always begins an authentication challenge. Later
    // segments beginning with `name=` are parameters on the prior challenge.
    if (first || !segment.trim().startsWith(`${match[1]}=`)) {
      schemes.add(match[1].toLowerCase());
    }
  };

  let first = true;
  for (let index = 0; index <= header.length; index++) {
    const character = header[index];
    if (index === header.length || (character === ',' && !quoted)) {
      inspectSegment(header.slice(segmentStart, index), first);
      first = false;
      segmentStart = index + 1;
      continue;
    }
    if (escaped) {
      escaped = false;
    } else if (character === '\\' && quoted) {
      escaped = true;
    } else if (character === '"') {
      quoted = !quoted;
    }
  }
  return schemes;
}

async function parseClaimsChallenge(
  response: Response,
  requestUrl: string,
): Promise<ClaimsChallenge> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('application/problem+json')) {
    throw new Error(
      'Identity-Presentation challenge must use application/problem+json',
    );
  }

  let value: unknown;
  try {
    const body = await response.clone().text();
    if (new TextEncoder().encode(body).byteLength > 64 * 1024) {
      throw new Error();
    }
    value = JSON.parse(body);
  } catch {
    throw new Error('Identity-Presentation challenge body is invalid');
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Identity-Presentation challenge body is invalid');
  }
  const challenge = value as Record<string, unknown>;
  const claims = challenge.claims;
  const formats = challenge.formats;
  const trustedIssuers = challenge.trusted_issuers;
  if (
    challenge.type !== 'urn:aap:claims-required' ||
    typeof challenge.aud !== 'string' ||
    typeof challenge.nonce !== 'string' ||
    challenge.nonce.length === 0 ||
    !Array.isArray(claims) ||
    claims.length === 0 ||
    claims.some((claim) => typeof claim !== 'string' || claim.length === 0) ||
    new Set(claims).size !== claims.length ||
    !Array.isArray(formats) ||
    !formats.includes('dc+sd-jwt') ||
    !Array.isArray(trustedIssuers) ||
    !trustedIssuers.includes('https://api.link.com')
  ) {
    throw new Error('Identity-Presentation challenge body is invalid');
  }

  const expectedAudience = new URL(requestUrl).origin;
  if (challenge.aud !== expectedAudience) {
    throw new Error(
      'Identity-Presentation challenge audience does not match the request origin',
    );
  }

  return {
    aud: challenge.aud,
    nonce: challenge.nonce,
    claims: claims as string[],
  };
}

async function createAapCredentialHeaders(
  probe: MppProbe,
  credentialProvider: AapCredentialProvider,
): Promise<{
  headers: Headers;
  ephemeralHeaderNames: string[];
} | null> {
  if (probe.response.status !== 401) {
    return null;
  }

  const wwwAuthenticate = probe.response.headers.get('www-authenticate');
  if (!wwwAuthenticate) return null;
  const schemes = authenticationSchemes(wwwAuthenticate);
  const needsAttestation = schemes.has('privatetoken');
  const needsClaims = schemes.has('identity-presentation');
  if (!needsAttestation && !needsClaims) {
    return null;
  }

  const headers = new Headers(probe.headers);
  const ephemeralHeaderNames: string[] = [];

  try {
    // Build the non-destructive presentation first. Only consume a one-time AAT
    // after all challenge validation and local credential checks have succeeded.
    if (needsClaims) {
      const challenge = await parseClaimsChallenge(probe.response, probe.url);
      const { presentation } =
        await credentialProvider.presentIdentityCredential({
          aud: challenge.aud,
          nonce: challenge.nonce,
          claim: challenge.claims,
        });
      headers.set('Identity-Presentation', presentation);
      ephemeralHeaderNames.push('identity-presentation');
    }
    if (needsAttestation) {
      const { authorization } = await credentialProvider.takeAttestation();
      headers.set('Authorization', authorization);
      ephemeralHeaderNames.push('authorization');
    }
  } catch (error) {
    await probe.response.body?.cancel();
    throw error;
  }

  return { headers, ephemeralHeaderNames };
}

async function answerAapChallenge(
  probe: MppProbe,
  fetcher: typeof fetch,
  credentialProvider: AapCredentialProvider,
): Promise<PreparedMppProbe> {
  const credentials = await createAapCredentialHeaders(
    probe,
    credentialProvider,
  );
  if (!credentials) return { probe, ephemeralHeaderNames: [] };

  await probe.response.body?.cancel();
  const response = await fetchMppRequest(
    { ...probe, headers: credentials.headers },
    fetcher,
  );
  if (isRedirectResponse(response)) {
    await response.body?.cancel();
    throw new Error(
      `Credential-bearing request returned redirect ${response.status}; refusing to forward identity credentials`,
    );
  }

  return {
    probe: { ...probe, headers: credentials.headers, response },
    ephemeralHeaderNames: credentials.ephemeralHeaderNames,
  };
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

export async function prepareMppProbe(
  initial: MppRequest,
  fetcher: typeof fetch = fetch,
  credentialProvider: AapCredentialProvider = defaultAapCredentialProvider,
): Promise<PreparedMppProbe> {
  return answerAapChallenge(
    await probeMppRequest(initial, fetcher),
    fetcher,
    credentialProvider,
  );
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
  aapCredentialProvider?: AapCredentialProvider;
}

export async function runMppPayWithSpendRequest(
  url: string,
  spendRequestId: string,
  method: string | undefined,
  data: string | undefined,
  headers: string[] | undefined,
  repository: ISpendRequestResource,
  approvedChallengeHeader?: string,
  credentialProvider?: AapCredentialProvider,
): Promise<PayResult> {
  const spendRequest = await repository.retrieve(spendRequestId, {
    include: ['shared_payment_token'],
  });

  if (!spendRequest) {
    throw new Error(`Spend request ${spendRequestId} not found`);
  }
  if (spendRequest.credential_type !== 'shared_payment_token') {
    const type = spendRequest.credential_type ?? 'card';
    throw new Error(
      `Spend request ${spendRequestId} must have credential_type 'shared_payment_token' (current: '${type}')`,
    );
  }
  if (spendRequest.status !== 'approved') {
    throw new Error(
      `Spend request must be approved (current status: ${spendRequest.status})`,
    );
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
    credentialProvider,
  );
}

export async function payWithSpt(
  url: string,
  spt: string,
  method: string | undefined,
  data: string | undefined,
  headers: string[] | undefined,
  approvedChallengeHeader?: string,
  credentialProvider?: AapCredentialProvider,
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
    credentialProvider,
  );
}

async function submitMppPayment(
  challenge: MppProbe,
  spt: string,
  credentialProvider: AapCredentialProvider,
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

  let submissionHeaders = challenge.headers;
  const privateToken = submissionHeaders.get('authorization');
  if (
    privateToken?.toLowerCase().startsWith('privatetoken ') &&
    (payment.challenge.header ?? 'Authorization').toLowerCase() ===
      'authorization'
  ) {
    throw new Error(
      'MPP payment challenge must select a separate credential header when Authorization carries a PrivateToken attestation',
    );
  }

  if (
    privateToken?.toLowerCase().startsWith('privatetoken ') ||
    submissionHeaders.has('identity-presentation')
  ) {
    // The credentials that unlocked the 402 may have consumed a one-time
    // identity nonce. Fetch a fresh 401, then attach those new access proofs
    // and the payment credential to the same final request.
    const unauthenticatedHeaders = new Headers(submissionHeaders);
    if (privateToken?.toLowerCase().startsWith('privatetoken ')) {
      unauthenticatedHeaders.delete('authorization');
    }
    unauthenticatedHeaders.delete('identity-presentation');
    const accessResponse = await fetchMppRequest({
      ...challenge,
      headers: unauthenticatedHeaders,
    });
    if (isRedirectResponse(accessResponse)) {
      await accessResponse.body?.cancel();
      throw new Error(
        `Access challenge refresh returned redirect ${accessResponse.status}; refusing to forward credentials`,
      );
    }
    const freshCredentials = await createAapCredentialHeaders(
      {
        ...challenge,
        headers: unauthenticatedHeaders,
        response: accessResponse,
      },
      credentialProvider,
    );
    if (!freshCredentials) {
      await accessResponse.body?.cancel();
      throw new Error(
        'Expected a fresh Link access challenge before submitting payment',
      );
    }
    await accessResponse.body?.cancel();
    submissionHeaders = freshCredentials.headers;
  }

  const paidRequest = payment.setCredential(
    {
      method: challenge.method,
      headers: submissionHeaders,
      body: challenge.body,
    },
    credential,
  );

  const response = await fetch(challenge.url, {
    ...paidRequest,
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
  credentialProvider: AapCredentialProvider = defaultAapCredentialProvider,
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
  const { probe: refreshed } = await answerAapChallenge(
    { ...request, response },
    fetch,
    credentialProvider,
  );
  const refreshedResponse = refreshed.response;
  if (refreshedResponse.status !== 402) return readPayResult(refreshedResponse);
  if (approvedChallenge) {
    let refreshedChallenge: Challenge.Challenge;
    try {
      refreshedChallenge =
        getStripeChargeChallengeFromResponse(refreshedResponse);
    } catch (error) {
      await refreshedResponse.body?.cancel();
      throw error;
    }
    if (
      comparableChallenge(refreshedChallenge) !==
      comparableChallenge(approvedChallenge)
    ) {
      await refreshedResponse.body?.cancel();
      throw new Error(
        'MPP challenge changed after approval; refusing to use the approved payment credential',
      );
    }
  }
  return submitMppPayment(refreshed, spt, credentialProvider);
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
    repository,
    paymentMethodsFactory,
    onStep,
    onApprovalUrl,
    aapCredentialProvider,
  } = opts;

  const httpMethod = method ?? (data !== undefined ? 'POST' : 'GET');
  const requestHeaders = buildHeaders(data, headers);

  // 1. Probe URL
  onStep?.('probing');
  const { probe } = await prepareMppProbe(
    createMppRequest(url, httpMethod, data, requestHeaders),
    fetch,
    aapCredentialProvider,
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
    aapCredentialProvider,
  );
}

export type Step =
  | 'probing'
  | 'creating'
  | 'approving'
  | 'signing'
  | 'submitting'
  | 'done';

export function MppApprovalPrompt({ approvalUrl }: { approvalUrl: string }) {
  useInput((_input, key) => {
    if (key.return) openUrl(approvalUrl);
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
      marginTop={1}
    >
      <Text>
        Approve in Link app:{' '}
        <Text bold color="cyan">
          {approvalUrl}
        </Text>
      </Text>
      <Text dimColor>Press Enter to open in browser</Text>
    </Box>
  );
}

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
            <MppApprovalPrompt approvalUrl={approvalUrl} />
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
