import { describe, expect, it } from 'vitest';
import { formatAmount, formatLinkAmount } from '../format-amount';

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

describe('formatLinkAmount', () => {
  it.each([
    [500, 'isk', 'ISK 5.00'],
    [500, 'ugx', 'UGX 5.00'],
    [1045, 'huf', 'HUF 10.45'],
    [123456789, 'HUF', 'HUF 1,234,567.89'],
  ])('formats %d %s with two decimals as %s', (amount, currency, expected) => {
    expect(formatLinkAmount(amount, currency)).toBe(expected);
  });

  it.each([
    [1234, 'usd', '$12.34'],
    [1000, 'jpy', '¥1,000'],
    [1000, 'kwd', 'KWD 1.000'],
    [1234, 'zz', '1234 zz'],
    [1234, '', '1234 '],
  ])('matches formatAmount for %d %s', (amount, currency, expected) => {
    expect(formatLinkAmount(amount, currency)).toBe(expected);
  });
});
