import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildUserAgent } from '../../utils/user-agent';
import { buildHeaders } from './pay';

beforeEach(() => {
  vi.stubGlobal('__CLI_VERSION__', 'test');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildHeaders', () => {
  it('sets JSON content type for a body and replaces it case insensitively', () => {
    expect(buildHeaders('', undefined).get('content-type')).toBe(
      'application/json',
    );
    expect(buildHeaders(undefined, undefined).has('content-type')).toBe(false);
    expect(
      buildHeaders('{}', ['content-type: text/plain']).get('content-type'),
    ).toBe('text/plain');
  });

  it('adds the CLI user agent unless the caller supplied one', () => {
    expect(buildHeaders(undefined, undefined).get('user-agent')).toBe(
      buildUserAgent('test', process.env),
    );
    expect(
      buildHeaders(undefined, ['user-agent: custom-agent']).get('user-agent'),
    ).toBe('custom-agent');
  });
});
