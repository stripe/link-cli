const STRIPE_ZERO_DECIMAL_CURRENCIES = new Set([
  'bif',
  'clp',
  'djf',
  'gnf',
  'jpy',
  'kmf',
  'krw',
  'mga',
  'pyg',
  'rwf',
  'vnd',
  'vuv',
  'xaf',
  'xof',
  'xpf',
]);

const STRIPE_THREE_DECIMAL_CURRENCIES = new Set([
  'bhd',
  'jod',
  'kwd',
  'omr',
  'tnd',
]);

function formatMinorUnits(
  amount: number,
  currency: string,
  fractionDigits?: number,
): string {
  try {
    const formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(amount / 10 ** digits);
  } catch {
    return `${amount} ${currency}`;
  }
}

function stripeFractionDigits(currency: string): number {
  const code = currency.toLowerCase();
  if (STRIPE_ZERO_DECIMAL_CURRENCIES.has(code)) return 0;
  if (STRIPE_THREE_DECIMAL_CURRENCIES.has(code)) return 3;
  return 2;
}

/**
 * Format a minor-unit amount (e.g. cents) into a human-readable major-unit
 * currency string. For example, 5 with currency "usd" becomes "$0.05".
 *
 * Falls back to `${amount} ${currency}` for unknown currency codes.
 */
export function formatAmount(amount: number, currency: string): string {
  return formatMinorUnits(amount, currency);
}

export function formatLinkAmount(amount: number, currency: string): string {
  return formatMinorUnits(amount, currency, stripeFractionDigits(currency));
}
