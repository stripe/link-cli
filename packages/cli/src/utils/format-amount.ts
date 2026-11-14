/**
 * Format a minor-unit amount (e.g. cents) into a human-readable major-unit
 * currency string. For example, 5 with currency "usd" becomes "$0.05".
 *
 * Falls back to `${amount} ${currency}` for unknown currency codes.
 */
export function formatAmount(amount: number, currency: string): string {
  const currencyCode = currency.toUpperCase();

  try {
    const formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode,
    });
    const fractionDigits =
      formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(amount / 10 ** fractionDigits);
  } catch {
    return `${amount} ${currency}`;
  }
}

const LINK_TWO_DECIMAL_CURRENCIES = new Set(['huf', 'isk', 'ugx']);

export function formatLinkAmount(amount: number, currency: string): string {
  if (!LINK_TWO_DECIMAL_CURRENCIES.has(currency.toLowerCase())) {
    return formatAmount(amount, currency);
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount / 100);
}
