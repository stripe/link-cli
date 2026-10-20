import { describe, expect, it } from 'vitest';
import { formatAmount } from '../format-amount';

describe('formatAmount', () => {
  it.each([
    [1234, 'usd', '$12.34'],
    [1234, 'eur', '€12.34'],
    [1000, 'jpy', '¥1,000'],
    [5000, 'krw', '₩5,000'],
    [1000, 'kwd', 'KWD 1.000'],
  ])('formats %d %s as %s', (amount, currency, expected) => {
    expect(formatAmount(amount, currency)).toBe(expected);
  });

  it('accepts uppercase currency codes', () => {
    expect(formatAmount(1234, 'USD')).toBe('$12.34');
  });

  it('falls back to the raw amount for unknown currency codes', () => {
    expect(formatAmount(1234, 'zz')).toBe('1234 zz');
  });
});
