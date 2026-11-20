import { describe, expect, it } from 'vitest';
import {
  getApiErrorDetails,
  LinkApiError,
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
    expect(new LinkTransportError('x')).toBeInstanceOf(LinkSdkError);
    expect(new LinkApiError('x', { status: 500 })).toBeInstanceOf(LinkSdkError);
  });

  it('preserves cause on subclasses', () => {
    const cause = new Error('root');
    const err = new LinkTransportError('failed', { cause });
    expect(err.cause).toBe(cause);
  });
});

describe('getApiErrorDetails', () => {
  it('validates the nested server envelope without changing api_error', () => {
    const details = {
      code: 'missing_permissions',
      message: 'Grant access',
      authorization_remediation: {
        scope: ['financial_insights.holdings.read'],
        authorization_details: [{ type: 'source', actions: ['read_holdings'] }],
      },
    };
    const error = new LinkApiError('Failed', {
      status: 403,
      details: { error: details },
      rawBody: 'never returned',
    });
    expect(getApiErrorDetails(error)).toEqual(details);
    expect(error.code).toBe('api_error');
  });

  it('preserves future server codes and code-only envelopes', () => {
    const error = new LinkApiError('Failed', {
      status: 409,
      details: { error: { code: 'future_error', extra: 'ignored' } },
    });
    expect(getApiErrorDetails(error)).toEqual({ code: 'future_error' });
  });

  it('accepts null remediation', () => {
    const error = new LinkApiError('Failed', {
      status: 422,
      details: {
        error: {
          code: 'holdings_not_supported',
          authorization_remediation: null,
        },
      },
    });
    expect(getApiErrorDetails(error)).toEqual({
      code: 'holdings_not_supported',
      authorization_remediation: null,
    });
  });

  it.each([
    undefined,
    null,
    'not JSON',
    {},
    { code: 'missing_permissions' },
    { error: 'failed' },
    { error: { message: 'no code' } },
    { error: { code: 1 } },
    { error: { code: 'failure', message: 1 } },
    {
      error: {
        code: 'missing_permissions',
        authorization_remediation: { scope: 'not an array' },
      },
    },
    {
      error: {
        code: 'missing_permissions',
        authorization_remediation: {
          authorization_details: [{ type: 'source', actions: [1] }],
        },
      },
    },
  ])(
    'returns null for absent or malformed details without reading rawBody: %j',
    (details) => {
      expect(
        getApiErrorDetails(
          new LinkApiError('Failed', {
            status: 500,
            details,
            rawBody: 'private payload',
          }),
        ),
      ).toBeNull();
    },
  );

  it('ignores other errors', () => {
    expect(getApiErrorDetails(new Error('ordinary error'))).toBeNull();
    expect(
      getApiErrorDetails({ details: { error: { code: 'spoof' } } }),
    ).toBeNull();
  });
});
