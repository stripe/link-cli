import { describe, expect, it } from 'vitest';
import { requestOptions } from '../schema';

describe('attestation request options', () => {
  it('accepts a count and optional export path', () => {
    expect(Object.keys(requestOptions.shape)).toEqual(['count', 'outputFile']);
    expect(requestOptions.parse({ count: '10' })).toEqual({ count: 10 });
    expect(
      requestOptions.parse({ count: 10, outputFile: './aats.json' }),
    ).toEqual({ count: 10, outputFile: './aats.json' });
    expect(requestOptions.safeParse({ count: 0 }).success).toBe(false);
    expect(requestOptions.safeParse({ count: 101 }).success).toBe(false);
    expect(requestOptions.safeParse({ count: 1, outputFile: '' }).success).toBe(
      false,
    );
  });
});
