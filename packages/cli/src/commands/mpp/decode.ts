import { Challenge } from 'mppx';

type StripeChargeChallenge = Challenge.Challenge<
  Record<string, unknown>,
  'charge',
  'stripe'
>;

type ResolvedStripeChallenge = {
  challenge: StripeChargeChallenge;
  networkId: string;
  request: Record<string, unknown>;
};

export interface DecodedStripeChallenge {
  id: string;
  realm: string;
  method: 'stripe';
  intent: 'charge';
  description?: string;
  digest?: string;
  expires?: string;
  network_id: string;
  request_json: Record<string, unknown>;
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

function getMethodDetails(
  request: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const methodDetails = request.methodDetails;
  if (methodDetails == null) {
    return undefined;
  }
  if (typeof methodDetails !== 'object' || Array.isArray(methodDetails)) {
    throw new Error(
      'Invalid stripe challenge request: methodDetails: expected object',
    );
  }
  return methodDetails as Record<string, unknown>;
}

function resolveStripeChallenge(
  challenges: Challenge.Challenge[],
): ResolvedStripeChallenge {
  const stripeChallenge = challenges.find(
    (challenge) =>
      challenge.method === 'stripe' && challenge.intent === 'charge',
  );

  if (!stripeChallenge) {
    throw new Error(
      'WWW-Authenticate header does not include a stripe charge challenge',
    );
  }

  if (
    typeof stripeChallenge.request !== 'object' ||
    stripeChallenge.request == null ||
    Array.isArray(stripeChallenge.request)
  ) {
    throw new Error(
      'Invalid stripe challenge request: request: expected object',
    );
  }

  const request = stripeChallenge.request as Record<string, unknown>;
  getString(request.amount, 'amount');
  getString(request.currency, 'currency');

  const methodDetails = getMethodDetails(request);
  const networkId =
    getString(methodDetails?.networkId, 'methodDetails.networkId', false) ??
    getString(request.networkId, 'networkId', false);

  if (!networkId) {
    throw new Error(
      'Invalid stripe challenge request: methodDetails.networkId: missing',
    );
  }

  return {
    challenge: stripeChallenge as StripeChargeChallenge,
    networkId,
    request,
  };
}

export function getStripeChargeChallengeFromResponse(
  response: Response,
): StripeChargeChallenge {
  return resolveStripeChallenge(Challenge.fromResponseList(response)).challenge;
}

export function decodeStripeChallenge(
  challengeHeader: string,
): DecodedStripeChallenge {
  const { challenge, networkId, request } = resolveStripeChallenge(
    Challenge.deserializeList(challengeHeader),
  );

  return {
    id: challenge.id,
    realm: challenge.realm,
    method: 'stripe',
    intent: 'charge',
    description: challenge.description,
    digest: challenge.digest,
    expires: challenge.expires,
    network_id: networkId,
    request_json: request,
  };
}
