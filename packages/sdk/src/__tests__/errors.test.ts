import { describe, expect, it } from 'vitest';
import {
  LinkApiError,
  LinkAuthenticationError,
  LinkConfigurationError,
  LinkSdkError,
  LinkTransportError,
} from '../errors';

describe('SDK error codes', () => {
  it('LinkSdkError has default code sdk_error', () => {
    const err = new LinkSdkError('test');
    expect(err.code).toBe('sdk_error');
  });

  it('LinkConfigurationError has code configuration_error', () => {
    const err = new LinkConfigurationError('bad config');
    expect(err.code).toBe('configuration_error');
  });

  it('LinkAuthenticationError has code not_authenticated', () => {
    const err = new LinkAuthenticationError('not logged in');
    expect(err.code).toBe('not_authenticated');
  });

  it('LinkTransportError has code transport_error', () => {
    const err = new LinkTransportError('network fail');
    expect(err.code).toBe('transport_error');
  });

  it('LinkApiError defaults to api_error', () => {
    const err = new LinkApiError('bad request', { status: 400 });
    expect(err.code).toBe('api_error');
  });

  it('LinkApiError accepts a custom code', () => {
    const err = new LinkApiError('expired', {
      status: 400,
      code: 'expired_token',
    });
    expect(err.code).toBe('expired_token');
  });

  it('all errors are instances of LinkSdkError', () => {
    expect(new LinkConfigurationError('x')).toBeInstanceOf(LinkSdkError);
    expect(new LinkAuthenticationError('x')).toBeInstanceOf(LinkSdkError);
    expect(new LinkTransportError('x')).toBeInstanceOf(LinkSdkError);
    expect(new LinkApiError('x', { status: 500 })).toBeInstanceOf(LinkSdkError);
  });

  it('preserves cause on subclasses', () => {
    const cause = new Error('root');
    const err = new LinkTransportError('failed', { cause });
    expect(err.cause).toBe(cause);
  });
});
