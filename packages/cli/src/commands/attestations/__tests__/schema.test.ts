import { describe, expect, it } from 'vitest';
import { requestOptions } from '../schema';

describe('attestation request options', () => {
  it('only accepts the token count', () => {
    expect(Object.keys(requestOptions.shape)).toEqual(['count']);
    expect(requestOptions.shape).not.toHaveProperty('issuer');
    expect(requestOptions.shape).not.toHaveProperty('accessToken');
    expect(requestOptions.shape).not.toHaveProperty('outputFile');
    expect(requestOptions.shape).not.toHaveProperty('force');
  });
});
