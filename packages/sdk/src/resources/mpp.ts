import { Challenge, Credential, Method } from 'mppx';
import { Mppx } from 'mppx/client';
import { Methods as StripeMethods } from 'mppx/stripe';
import {
  type LinkOptions,
  requireFetchImplementation,
  resolveLinkSdkConfig,
} from '@/config';
import type {
  DecodedMppChallenge,
  DecodedStripeChallenge,
  DecodedStripeChallengeRequest,
  IMppResource,
  IPaymentMethodsResource,
  ISpendRequestResource,
  MppPaymentResult,
  MppPayOptions,
} from '@/resources/interfaces';
import { PaymentMethodsResource } from '@/resources/payment-methods';
import { SpendRequestResource } from '@/resources/spend-request';

type StripeChallenge = Challenge.Challenge<
  Record<string, unknown>,
  'charge' | 'session',
  'stripe'
>;

interface MppResourceDependencies {
  spendRequests?: ISpendRequestResource;
  paymentMethods?: IPaymentMethodsResource;
}

type MppPaymentStep = 'probing' | 'creating';

interface MppRequestOptions {
  url: string;
  method?: string;
  body?: string;
  headers?: HeadersInit;
}

interface MppProbeResult {
  url: string;
  method: string;
  headers: Headers;
  body?: string;
  response: Response;
}

interface PreparedMppPayment {
  probe: MppProbeResult;
  challenge: StripeChallenge;
  challengeHeader: string;
  decoded: DecodedStripeChallenge;
}

interface NormalizedMppRequest {
  url: string;
  method: string;
  headers: Headers;
  body: string | undefined;
}

interface MppCreateSpendRequestOptions extends MppRequestOptions {
  context: string;
  amount?: number;
  paymentMethodId?: string;
  test?: boolean;
  onStep?: (step: MppPaymentStep) => void;
}

interface MppSpendRequestResult {
  spendRequest: import('@/types').SpendRequest;
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  };
  approvedChallenge: string;
}

interface MppPayWithSharedPaymentTokenOptions extends MppRequestOptions {
  sharedPaymentToken: string;
  approvedChallenge?: string;
}

const SPT_RETRIEVAL_DELAYS_MS = [
  0, 1000, 1000, 1000, 2000, 2000, 2000, 2000,
] as const;

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function isHttpLoopback(url: URL): boolean {
  return (
    url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' ||
      url.hostname === 'localhost' ||
      url.hostname === '[::1]')
  );
}

function assertSafeMppUrl(url: URL): void {
  if (url.protocol === 'https:' || isHttpLoopback(url)) return;
  throw new Error(
    `MPP requests require HTTPS (HTTP is allowed only for localhost development): ${url.href}`,
  );
}

function isRedirectResponse(response: Response): boolean {
  return response.status >= 300 && response.status < 400;
}

function normalizeRequest(options: MppRequestOptions): NormalizedMppRequest {
  const url = new URL(options.url);
  assertSafeMppUrl(url);
  return {
    url: url.href,
    method: (
      options.method ?? (options.body !== undefined ? 'POST' : 'GET')
    ).toUpperCase(),
    headers: new Headers(options.headers),
    body: options.body,
  };
}

function getString(
  value: unknown,
  path: string,
  required = true,
): string | undefined {
  if (value == null) {
    if (required) {
      throw new Error(`Invalid stripe challenge request: ${path}: missing`);
    }
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(
      `Invalid stripe challenge request: ${path}: expected string, received ${typeof value}`,
    );
  }
  return value;
}

function getRequiredString(value: unknown, path: string): string {
  const result = getString(value, path);
  if (result === undefined) {
    throw new Error(`Invalid stripe challenge request: ${path}: missing`);
  }
  return result;
}

function getOptionalStringArray(
  value: unknown,
  path: string,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(
      `Invalid stripe challenge request: ${path}: expected string array`,
    );
  }
  return value;
}

function getOptionalStringRecord(
  value: unknown,
  path: string,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'object' ||
    value == null ||
    Array.isArray(value) ||
    Object.values(value).some((item) => typeof item !== 'string')
  ) {
    throw new Error(
      `Invalid stripe challenge request: ${path}: expected string record`,
    );
  }
  return value as Record<string, string>;
}

function isSupportedStripeChallenge(
  challenge: Challenge.Challenge,
): challenge is StripeChallenge {
  return (
    challenge.method === 'stripe' &&
    (challenge.intent === 'charge' || challenge.intent === 'session')
  );
}

function parseStripeChallenge(challenge: StripeChallenge): {
  challenge: StripeChallenge;
  decoded: DecodedStripeChallenge;
} {
  if (
    typeof challenge.request !== 'object' ||
    challenge.request == null ||
    Array.isArray(challenge.request)
  ) {
    throw new Error(
      'Invalid stripe challenge request: request: expected object',
    );
  }

  const request = challenge.request as Record<string, unknown>;
  const amount = getRequiredString(request.amount, 'amount');
  const currency = getRequiredString(request.currency, 'currency');
  const methodDetails = request.methodDetails;
  if (
    methodDetails != null &&
    (typeof methodDetails !== 'object' || Array.isArray(methodDetails))
  ) {
    throw new Error(
      'Invalid stripe challenge request: methodDetails: expected object',
    );
  }
  const details = methodDetails as Record<string, unknown> | undefined;
  const networkId =
    getString(details?.networkId, 'methodDetails.networkId', false) ??
    getString(request.networkId, 'networkId', false);
  if (!networkId) {
    throw new Error(
      'Invalid stripe challenge request: methodDetails.networkId: missing',
    );
  }
  const paymentMethodTypes = getOptionalStringArray(
    details?.paymentMethodTypes,
    'methodDetails.paymentMethodTypes',
  );
  const metadata = getOptionalStringRecord(
    details?.metadata,
    'methodDetails.metadata',
  );

  const requestJson: DecodedStripeChallengeRequest = {
    ...request,
    amount,
    currency,
    ...(details && {
      methodDetails: {
        ...details,
        networkId,
        ...(paymentMethodTypes && { paymentMethodTypes }),
        ...(metadata && { metadata }),
      },
    }),
  };
  return {
    challenge,
    decoded: {
      id: challenge.id,
      realm: challenge.realm,
      method: 'stripe',
      intent: challenge.intent,
      ...(challenge.description !== undefined && {
        description: challenge.description,
      }),
      ...(challenge.digest !== undefined && {
        digest: challenge.digest,
      }),
      ...(challenge.expires !== undefined && {
        expires: challenge.expires,
      }),
      ...(challenge.header !== undefined && { header: challenge.header }),
      ...(challenge.meta !== undefined && { meta: challenge.meta }),
      ...(challenge.opaque !== undefined && { opaque: challenge.opaque }),
      network_id: networkId,
      request_json: requestJson,
    },
  };
}

function resolveStripeChallenge(challenges: Challenge.Challenge[]): {
  challenge: StripeChallenge;
  decoded: DecodedStripeChallenge;
} {
  const challenge = challenges.find(isSupportedStripeChallenge);
  if (!challenge) {
    throw new Error(
      'WWW-Authenticate header does not include a supported stripe charge or session challenge',
    );
  }
  return parseStripeChallenge(challenge);
}

export function decodeMppChallenges(
  challengeHeader: string,
): DecodedMppChallenge[] {
  const challenges = Challenge.deserializeList(challengeHeader).filter(
    isSupportedStripeChallenge,
  );
  if (challenges.length === 0) {
    throw new Error(
      'WWW-Authenticate header does not include a supported stripe charge or session challenge',
    );
  }
  return challenges.map((challenge) => parseStripeChallenge(challenge).decoded);
}

function challengeFromResponse(response: Response): StripeChallenge {
  return resolveStripeChallenge(Challenge.fromResponseList(response)).challenge;
}

function challengeFromHeader(header: string): StripeChallenge {
  return resolveStripeChallenge(Challenge.deserializeList(header)).challenge;
}

function comparableChallenge(challenge: Challenge.Challenge): string {
  return Challenge.serialize({
    ...challenge,
    id: 'approval-comparison',
    expires: undefined,
  });
}

/** Machine Payment Protocol flows backed by Link shared payment tokens. */
export class MppResource implements IMppResource {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly spendRequests: ISpendRequestResource;
  private readonly paymentMethods: IPaymentMethodsResource;

  constructor(
    options: LinkOptions,
    dependencies: MppResourceDependencies = {},
  ) {
    this.fetchImpl = requireFetchImplementation(resolveLinkSdkConfig(options));
    this.spendRequests =
      dependencies.spendRequests ?? new SpendRequestResource(options);
    this.paymentMethods =
      dependencies.paymentMethods ?? new PaymentMethodsResource(options);
  }

  decodeChallenge(challengeHeader: string): DecodedMppChallenge[] {
    return decodeMppChallenges(challengeHeader);
  }

  async probe(options: MppRequestOptions): Promise<MppProbeResult> {
    const initial = normalizeRequest(options);
    const prepared = await this.createPaymentClient().prepareRequest(
      initial.url,
      {
        ...(initial.body !== undefined && { body: initial.body }),
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
      url: prepared.request.url,
      method,
      headers: new Headers(prepared.request.headers),
      ...(method !== 'GET' && method !== 'HEAD' && initial.body !== undefined
        ? { body: initial.body }
        : {}),
      response,
    };
  }

  /** @internal Used by the CLI to orchestrate its interactive approval flow. */
  async createSpendRequest(
    options: MppCreateSpendRequestOptions,
  ): Promise<MppSpendRequestResult | MppPaymentResult> {
    options.onStep?.('probing');
    const probe = await this.probe(options);
    if (probe.response.status !== 402) {
      return this.readResult(probe.response);
    }
    const prepared = this.parsePreparedPayment(probe);
    try {
      const spendRequest = await this.createLinkSpendRequest(
        options,
        prepared.decoded,
      );
      const request = {
        url: prepared.probe.url,
        method: prepared.probe.method,
        headers: Object.fromEntries(prepared.probe.headers.entries()),
        ...(prepared.probe.body !== undefined && {
          body: prepared.probe.body,
        }),
      };
      return {
        spendRequest,
        request,
        approvedChallenge: prepared.challengeHeader,
      };
    } finally {
      await prepared.probe.response.body?.cancel().catch(() => undefined);
    }
  }

  async pay(options: MppPayOptions): Promise<MppPaymentResult> {
    const spendRequest = await this.spendRequests.retrieve(
      options.spendRequestId,
      { include: ['shared_payment_token'] },
    );
    if (!spendRequest) {
      throw new Error(`Spend request ${options.spendRequestId} not found`);
    }
    if (spendRequest.credential_type !== 'shared_payment_token') {
      const type = spendRequest.credential_type ?? 'card';
      throw new Error(
        `Spend request ${options.spendRequestId} must have credential_type 'shared_payment_token' (current: '${type}')`,
      );
    }
    if (spendRequest.status !== 'approved') {
      throw new Error(
        `Spend request must be approved (current status: ${spendRequest.status})`,
      );
    }
    const sharedPaymentToken =
      spendRequest.shared_payment_token?.id ??
      (await this.retrieveSharedPaymentToken(options.spendRequestId, false));
    return this.payWithSharedPaymentToken({
      url: options.url,
      ...(options.method !== undefined && { method: options.method }),
      ...(options.body !== undefined && { body: options.body }),
      ...(options.headers !== undefined && { headers: options.headers }),
      sharedPaymentToken,
      ...(options.challenge !== undefined && {
        approvedChallenge: options.challenge,
      }),
    });
  }

  private async payWithSharedPaymentToken(
    options: MppPayWithSharedPaymentTokenOptions,
  ): Promise<MppPaymentResult> {
    const request = normalizeRequest(options);
    const response = await this.fetchRequest(request);
    if (isRedirectResponse(response)) {
      await response.body?.cancel();
      throw new Error(
        `MPP challenge destination redirected with status ${response.status} after approval`,
      );
    }
    if (response.status !== 402) return this.readResult(response);
    const probe: MppProbeResult = {
      url: request.url,
      method: request.method,
      headers: request.headers,
      ...(request.body !== undefined && { body: request.body }),
      response,
    };
    if (options.approvedChallenge) {
      const approvedChallenge = challengeFromHeader(options.approvedChallenge);
      let refreshedChallenge: StripeChallenge;
      try {
        refreshedChallenge = challengeFromResponse(response);
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
    return this.submitPayment(probe, options.sharedPaymentToken);
  }

  private createPaymentClient(sharedPaymentToken?: string) {
    const stripeCharge = Method.toClient(StripeMethods.charge, {
      async createCredential({ challenge }) {
        if (!sharedPaymentToken) {
          throw new Error('A shared payment token is required to pay');
        }
        return Credential.serialize({
          challenge,
          payload: { spt: sharedPaymentToken },
        });
      },
    });
    const stripeSession = Method.toClient(
      { ...StripeMethods.charge, intent: 'session' as const },
      {
        async createCredential({ challenge }) {
          if (!sharedPaymentToken) {
            throw new Error('A shared payment token is required to pay');
          }
          return Credential.serialize({
            challenge,
            payload: { action: 'open', grantedToken: sharedPaymentToken },
          });
        },
      },
    );
    return Mppx.create({
      fetch: this.createSafeFetch(),
      methods: [stripeCharge, stripeSession],
      polyfill: false,
    });
  }

  private createSafeFetch(): typeof globalThis.fetch {
    return async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);
      assertSafeMppUrl(url);
      return this.fetchImpl(input, init);
    };
  }

  private async fetchRequest(
    request: NormalizedMppRequest | Omit<MppProbeResult, 'response'>,
  ): Promise<Response> {
    return this.fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body !== undefined && { body: request.body }),
      redirect: 'manual',
    });
  }

  private parsePreparedPayment(probe: MppProbeResult): PreparedMppPayment {
    const challengeHeader = probe.response.headers.get('www-authenticate');
    if (!challengeHeader) {
      throw new Error('URL returned 402 but no WWW-Authenticate header');
    }
    const resolved = resolveStripeChallenge(
      Challenge.fromResponseList(probe.response),
    );
    return { probe, challengeHeader, ...resolved };
  }

  private async createLinkSpendRequest(
    options: MppCreateSpendRequestOptions,
    decoded: DecodedStripeChallenge,
  ) {
    const challengeAmount = decoded.request_json.amount
      ? Number(decoded.request_json.amount)
      : undefined;
    const amount = options.amount ?? challengeAmount;
    if (
      options.amount !== undefined &&
      challengeAmount !== undefined &&
      options.amount !== challengeAmount
    ) {
      throw new Error(
        `--amount must match the MPP challenge amount (${challengeAmount})`,
      );
    }
    if (!amount) {
      throw new Error(
        'Could not determine amount from 402 challenge. Pass an amount explicitly.',
      );
    }
    let paymentMethodId = options.paymentMethodId;
    if (!paymentMethodId) {
      options.onStep?.('creating');
      const methods = await this.paymentMethods.list();
      const paymentMethod = methods[0];
      if (!paymentMethod) {
        throw new Error('No Link payment methods found.');
      }
      paymentMethodId = paymentMethod.id;
    }
    options.onStep?.('creating');
    return this.spendRequests.create({
      payment_details: paymentMethodId,
      credential_type: 'shared_payment_token',
      network_id: decoded.network_id,
      amount,
      currency: (decoded.request_json.currency as string) ?? 'usd',
      context: options.context,
      request_approval: true,
      ...(options.test && { test: true }),
    });
  }

  private async retrieveSharedPaymentToken(
    spendRequestId: string,
    includeInitialDelay: boolean,
  ): Promise<string> {
    const delays = includeInitialDelay
      ? SPT_RETRIEVAL_DELAYS_MS
      : SPT_RETRIEVAL_DELAYS_MS.slice(1);
    for (const delayMs of delays) {
      if (delayMs > 0) await sleep(delayMs);
      const request = await this.spendRequests.retrieve(spendRequestId, {
        include: ['shared_payment_token'],
      });
      if (!request) {
        throw new Error(`Spend request ${spendRequestId} not found`);
      }
      if (request.shared_payment_token?.id) {
        return request.shared_payment_token.id;
      }
    }
    throw new Error('Failed to retrieve shared payment token');
  }

  private async submitPayment(
    challenge: MppProbeResult,
    sharedPaymentToken: string,
  ): Promise<MppPaymentResult> {
    const credentialResponse = new Response(null, {
      status: challenge.response.status,
      statusText: challenge.response.statusText,
      headers: challenge.response.headers,
    });
    const payment =
      await this.createPaymentClient(sharedPaymentToken).preparePayment(
        credentialResponse,
      );
    const credential = await payment.createCredential();
    await challenge.response.body?.cancel();
    const response = await this.fetchImpl(challenge.url, {
      ...payment.setCredential(
        {
          method: challenge.method,
          headers: challenge.headers,
          ...(challenge.body !== undefined && { body: challenge.body }),
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
    return this.readResult(response);
  }

  private async readResult(response: Response): Promise<MppPaymentResult> {
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text(),
    };
  }
}
