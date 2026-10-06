import { Challenge } from 'mppx';
import { usdce } from 'viem/tokens';

const USDC_BASE_UNITS_PER_CENT = 10_000n;
const TEMPO_CHAIN_ID = 4217n;

export class MalformedHttpPaymentChallenge extends Error {}
export class UnsupportedHttpPaymentChallenge extends Error {}

export interface EvaluatedHttpPaymentChallenge {
  payment_request: {
    recipient: string;
    amount_base_units: bigint;
    currency: string;
    chain_id: bigint;
  };
  amount: bigint;
  currency: 'usd';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(
  object: Record<string, unknown>,
  field: string,
): string {
  const value = object[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new MalformedHttpPaymentChallenge();
  }
  return value;
}

function parseAmount(value: unknown): bigint {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) {
    throw new MalformedHttpPaymentChallenge();
  }
  return BigInt(value);
}

export function evaluateHttpPaymentChallenge(
  paymentChallenge: string,
): EvaluatedHttpPaymentChallenge {
  let challenges: Challenge.Challenge[];
  try {
    challenges = Challenge.deserializeList(paymentChallenge);
  } catch {
    throw new MalformedHttpPaymentChallenge();
  }
  const tempoChallenge = challenges.find(
    ({ method, intent }) => method === 'tempo' && intent === 'charge',
  );
  if (!tempoChallenge) {
    throw new UnsupportedHttpPaymentChallenge();
  }
  if (!isObject(tempoChallenge.request)) {
    throw new MalformedHttpPaymentChallenge();
  }
  if (
    typeof tempoChallenge.expires !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      tempoChallenge.expires,
    ) ||
    !Number.isFinite(Date.parse(tempoChallenge.expires))
  ) {
    throw new MalformedHttpPaymentChallenge();
  }

  const recipient = requiredString(tempoChallenge.request, 'recipient');
  const currency = requiredString(tempoChallenge.request, 'currency');
  const amountBaseUnits = parseAmount(tempoChallenge.request.amount);
  const methodDetails = tempoChallenge.request.methodDetails;
  if (!isObject(methodDetails)) {
    throw new MalformedHttpPaymentChallenge();
  }
  const rawChainId = methodDetails.chainId;
  if (typeof rawChainId !== 'number' || !Number.isSafeInteger(rawChainId)) {
    throw new MalformedHttpPaymentChallenge();
  }
  const chainId = BigInt(rawChainId);

  if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
    throw new MalformedHttpPaymentChallenge();
  }
  if (chainId !== TEMPO_CHAIN_ID) {
    throw new UnsupportedHttpPaymentChallenge();
  }

  if (
    amountBaseUnits < USDC_BASE_UNITS_PER_CENT ||
    amountBaseUnits % USDC_BASE_UNITS_PER_CENT !== 0n
  ) {
    throw new UnsupportedHttpPaymentChallenge();
  }
  if (currency.toLowerCase() !== usdce.addresses[4217].toLowerCase()) {
    throw new UnsupportedHttpPaymentChallenge();
  }

  return {
    payment_request: {
      recipient,
      amount_base_units: amountBaseUnits,
      currency,
      chain_id: chainId,
    },
    amount: amountBaseUnits / USDC_BASE_UNITS_PER_CENT,
    currency: 'usd',
  };
}
