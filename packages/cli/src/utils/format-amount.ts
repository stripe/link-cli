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
