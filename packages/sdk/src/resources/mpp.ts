import { Challenge, Credential, Method } from 'mppx';
import { Mppx } from 'mppx/client';
import { Methods as StripeMethods } from 'mppx/stripe';
import {
  type LinkOptions,
  requireFetchImplementation,
  resolveLinkSdkConfig,
} from '@/config';
import type {
  DecodedStripeChallenge,
  IMppResource,
  ISpendRequestResource,
  MppDecodeResult,
  MppPaymentResult,
  MppPayOptions,
  MppRequest,
} from '@/resources/interfaces';
import type { SpendRequest } from '@/types';

type StripeChallenge = Challenge.Challenge<
  Record<string, unknown>,
  'charge' | 'session',
  'stripe'
>;

interface NormalizedMppRequest {
  url: string;
  method: string;
  headers: Headers;
  body: string | undefined;
}

interface MppProbeResult {
  url: string;
  method: string;
  headers: Headers;
  body?: string;
  response: Response;
}

const SPT_RETRIEVAL_DELAYS_MS = [
  1000, 1000, 1000, 2000, 2000, 2000, 2000,
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

function normalizeRequest(options: MppRequest): NormalizedMppRequest {
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

function isSupportedStripeChallenge(
  challenge: Challenge.Challenge,
): challenge is StripeChallenge {
  return (
    challenge.method === 'stripe' &&
    (challenge.intent === 'charge' || challenge.intent === 'session')
  );
}

function parseStripeChallenge(
  challenge: StripeChallenge,
): DecodedStripeChallenge {
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
  const amount = getString(request.amount, 'amount') as string;
  const currency = getString(request.currency, 'currency') as string;
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

  return {
    id: challenge.id,
    realm: challenge.realm,
    method: 'stripe',
    intent: challenge.intent,
    ...(challenge.description !== undefined && {
      description: challenge.description,
    }),
    ...(challenge.digest !== undefined && { digest: challenge.digest }),
    ...(challenge.expires !== undefined && { expires: challenge.expires }),
    network_id: networkId,
    request_json: { ...request, amount, currency },
  };
}

export function decodeMppChallenges(
  challengeHeader: string,
): DecodedStripeChallenge[] {
  const challenges = Challenge.deserializeList(challengeHeader).filter(
    isSupportedStripeChallenge,
  );
  if (challenges.length === 0) {
    throw new Error(
      'WWW-Authenticate header does not include a stripe charge or session challenge',
    );
  }
  return challenges.map(parseStripeChallenge);
}

function decodeResponseChallenges(
  response: Response,
): DecodedStripeChallenge[] {
  const challengeHeader = response.headers.get('www-authenticate');
  if (!challengeHeader) {
    throw new Error('URL returned 402 but no WWW-Authenticate header');
  }
  return decodeMppChallenges(challengeHeader);
}

/** Machine Payment Protocol flows backed by Link shared payment tokens. */
export class MppResource implements IMppResource {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly spendRequests: ISpendRequestResource;

  constructor(options: LinkOptions, spendRequests: ISpendRequestResource) {
    this.fetchImpl = requireFetchImplementation(resolveLinkSdkConfig(options));
    this.spendRequests = spendRequests;
  }

  async decode(request: MppRequest): Promise<MppDecodeResult> {
    const probe = await this.probe(request);
    if (probe.response.status !== 402) {
      return {
        payment_required: false,
        response: await this.readResult(probe.response),
      };
    }
    try {
      return {
        payment_required: true,
        challenges: decodeResponseChallenges(probe.response),
        request: {
          url: probe.url,
          method: probe.method,
          headers: Object.fromEntries(probe.headers),
          ...(probe.body !== undefined && { body: probe.body }),
        },
      };
    } finally {
      await probe.response.body?.cancel().catch(() => undefined);
    }
  }

  async pay(
    request: MppRequest,
    options: MppPayOptions,
  ): Promise<MppPaymentResult> {
    const probe = await this.probe(request);
    if (probe.response.status !== 402) {
      return this.readResult(probe.response);
    }
    if (new URL(probe.url).origin !== new URL(request.url).origin) {
      await probe.response.body?.cancel().catch(() => undefined);
      throw new Error(
        'MPP challenge destination redirected to a different origin; refusing to send any payment credential',
      );
    }

    let spendRequest: SpendRequest;
    try {
      const [decoded] = decodeResponseChallenges(probe.response);
      const retrieved = await this.spendRequests.retrieve(
        options.spendRequestId,
        { include: ['shared_payment_token'] },
      );
      if (!retrieved) {
        throw new Error(`Spend request ${options.spendRequestId} not found`);
      }
      if (retrieved.status !== 'approved') {
        throw new Error(
          `Spend request must be approved (current status: ${retrieved.status})`,
        );
      }
      if (retrieved.credential_type !== 'shared_payment_token') {
        const type = retrieved.credential_type ?? 'card';
        throw new Error(
          `Spend request ${options.spendRequestId} must have credential_type 'shared_payment_token' (current: '${type}')`,
        );
      }
      this.assertChallengeMatchesSpendRequest(
        decoded as DecodedStripeChallenge,
        retrieved,
      );
      spendRequest = retrieved;
    } catch (error) {
      await probe.response.body?.cancel().catch(() => undefined);
      throw error;
    }

    const sharedPaymentToken =
      spendRequest.shared_payment_token?.id ??
      (await this.retrieveSharedPaymentToken(options.spendRequestId));
    return this.submitPayment(probe, sharedPaymentToken);
  }

  /** Checks terms, not challenge identity, so sellers can rotate challenge IDs between decode and pay. */
  private assertChallengeMatchesSpendRequest(
    decoded: DecodedStripeChallenge,
    spendRequest: SpendRequest,
  ): void {
    const amount = Number(decoded.request_json.amount);
    if (
      !Number.isFinite(amount) ||
      spendRequest.amount === undefined ||
      amount !== spendRequest.amount
    ) {
      throw new Error(
        `MPP challenge amount (${decoded.request_json.amount}) does not match the spend request amount (${spendRequest.amount})`,
      );
    }
    if (
      spendRequest.currency === undefined ||
      decoded.request_json.currency.toLowerCase() !==
        spendRequest.currency.toLowerCase()
    ) {
      throw new Error(
        `MPP challenge currency (${decoded.request_json.currency}) does not match the spend request currency (${spendRequest.currency})`,
      );
    }
    if (decoded.network_id !== spendRequest.network_id) {
      throw new Error(
        `MPP challenge network (${decoded.network_id}) does not match the spend request network (${spendRequest.network_id})`,
      );
    }
  }

  private async probe(options: MppRequest): Promise<MppProbeResult> {
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

  private createPaymentClient(sharedPaymentToken?: string) {
    const stripeCharge = Method.toClient(StripeMethods.charge, {
      async createCredential({ challenge }) {
        if (!sharedPaymentToken) {
          throw new Error('A shared payment token is required to pay');
        }
        return Credential.serialize({
          challenge,
          payload: {
            spt: sharedPaymentToken,
            ...(typeof challenge.request.externalId === 'string'
              ? { externalId: challenge.request.externalId }
              : {}),
          },
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

  private async retrieveSharedPaymentToken(
    spendRequestId: string,
  ): Promise<string> {
    for (const delayMs of SPT_RETRIEVAL_DELAYS_MS) {
      await sleep(delayMs);
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
