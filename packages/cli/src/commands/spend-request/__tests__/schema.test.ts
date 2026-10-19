import { describe, expect, it } from 'vitest';
import { createOptions } from '../schema';

const purchase = { amount: 100, context: 'Purchase context. '.repeat(10) };
const callbackUrl =
  'https://agent.example.com/link/callback?return=%2fcheckout';

describe('spend-request callback context', () => {
  it('accepts omitted callback context', () => {
    const result = createOptions.parse(purchase);
    expect(result.completionCallbackUrl).toBeUndefined();
    expect(result.nonce).toBeUndefined();
  });

  it.each([' opaque+nonce ', 'a'.repeat(512), '\u{10000}'.repeat(256)])(
    'preserves valid callback context %#',
    (nonce) => {
      const result = createOptions.parse({
        ...purchase,
        completionCallbackUrl: callbackUrl,
        nonce,
      });
      expect(result.completionCallbackUrl).toBe(callbackUrl);
      expect(result.nonce).toBe(nonce);
    },
  );

  it('accepts a callback URL at the length limit', () => {
    const url = `https://agent.example.com/${'a'.repeat(2022)}`;
    expect(url.length).toBe(2048);
    expect(
      createOptions.parse({
        ...purchase,
        completionCallbackUrl: url,
        nonce: 'n',
      }).completionCallbackUrl,
    ).toBe(url);
  });

  it.each([
    { completionCallbackUrl: callbackUrl },
    { nonce: 'nonce' },
    { completionCallbackUrl: callbackUrl, nonce: '' },
    { completionCallbackUrl: callbackUrl, nonce: ' \t\n' },
    { completionCallbackUrl: callbackUrl, nonce: 'a'.repeat(513) },
    { completionCallbackUrl: callbackUrl, nonce: `${'\u{10000}'.repeat(256)}a` },
    { completionCallbackUrl: 'not a URL', nonce: 'nonce' },
    {
      completionCallbackUrl: `https://agent.example.com/${'a'.repeat(2023)}`,
      nonce: 'nonce',
    },
  ])('rejects invalid callback context %#', (input) => {
    expect(createOptions.safeParse({ ...purchase, ...input }).success).toBe(
      false,
    );
  });
});
