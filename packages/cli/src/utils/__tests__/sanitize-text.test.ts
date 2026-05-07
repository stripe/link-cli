import { describe, expect, it } from 'vitest';
import { sanitizeDeep, sanitizeText } from '../sanitize-text';

describe('sanitizeText', () => {
  it('returns empty string for null/undefined', () => {
    expect(sanitizeText(null)).toBe('');
    expect(sanitizeText(undefined)).toBe('');
    expect(sanitizeText('')).toBe('');
  });

  it('passes through normal text unchanged', () => {
    expect(sanitizeText('Hello World')).toBe('Hello World');
    expect(sanitizeText('Café & Résumé')).toBe('Café & Résumé');
  });

  it('strips CSI sequences (colors, cursor movement)', () => {
    expect(sanitizeText('\x1b[2JScreen Cleared')).toBe('Screen Cleared');
    expect(sanitizeText('\x1b[1A\x1b[2KOverwrite')).toBe('Overwrite');
    expect(sanitizeText('\x1b[31mRed Text\x1b[0m')).toBe('Red Text');
  });

  it('strips OSC sequences (window title, hyperlinks)', () => {
    expect(sanitizeText('\x1b]0;PWNED\x07Normal Store')).toBe('Normal Store');
    expect(sanitizeText('\x1b]8;;https://evil.com\x07Click\x1b]8;;\x07')).toBe(
      'Click',
    );
  });

  it('strips carriage returns', () => {
    expect(sanitizeText('Legit Store\rEvil Store')).toBe(
      'Legit StoreEvil Store',
    );
  });

  it('strips other control characters', () => {
    expect(sanitizeText('Hello\x00World')).toBe('HelloWorld');
    expect(sanitizeText('Tab\x09is fine but \x01 is not')).toBe(
      'Tab\tis fine but  is not',
    );
  });

  it('preserves newlines and tabs', () => {
    expect(sanitizeText('Line1\nLine2')).toBe('Line1\nLine2');
    expect(sanitizeText('Col1\tCol2')).toBe('Col1\tCol2');
  });

  it('handles compound attack payloads', () => {
    const payload = '\x1b[2J\x1b[1;1H\x1b]0;Hijacked\x07\rAmount: $0.01';
    expect(sanitizeText(payload)).toBe('Amount: $0.01');
  });
});

describe('sanitizeDeep', () => {
  it('sanitizes strings in nested objects', () => {
    const input = {
      merchant_name: '\x1b[2JEvil',
      amount: 1000,
      line_items: [{ name: '\rHidden' }],
      card: { billing_address: { name: '\x1b]0;X\x07Test' } },
    };
    const result = sanitizeDeep(input);
    expect(result.merchant_name).toBe('Evil');
    expect(result.amount).toBe(1000);
    expect(result.line_items[0].name).toBe('Hidden');
    expect(result.card.billing_address.name).toBe('Test');
  });

  it('passes through null, undefined, and primitives', () => {
    expect(sanitizeDeep(null)).toBe(null);
    expect(sanitizeDeep(undefined)).toBe(undefined);
    expect(sanitizeDeep(42)).toBe(42);
    expect(sanitizeDeep(true)).toBe(true);
  });

  it('sanitizes arrays of strings', () => {
    const input = ['\x1b[2JA', 'B', '\rC'];
    expect(sanitizeDeep(input)).toEqual(['A', 'B', 'C']);
  });
});
