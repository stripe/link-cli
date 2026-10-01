import type { SpendRequestRecurring } from '@stripe/link-sdk';

/**
 * Format recurring spend request terms, e.g. "every month" or "every 2 weeks".
 */
export function formatRecurring(recurring: SpendRequestRecurring): string {
  const count = recurring.interval_count;
  return count === 1
    ? `every ${recurring.interval}`
    : `every ${count} ${recurring.interval}s`;
}
