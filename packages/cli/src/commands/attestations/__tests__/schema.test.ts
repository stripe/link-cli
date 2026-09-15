import { describe, expect, it } from 'vitest';
import { requestOptions } from '../schema';

describe('attestation request options', () => {
  it('does not allow callers to select an issuer', () => {
    expect(requestOptions.shape).not.toHaveProperty('issuer');
  });
});
