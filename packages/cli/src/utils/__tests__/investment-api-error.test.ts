import { LinkApiError } from '@stripe/link-sdk';
import { describe, expect, it } from 'vitest';
import { investmentApiError } from '../investment-api-error';

function apiError(details?: unknown) {
  return new LinkApiError('sensitive raw body', {
    status: 403,
    rawBody: 'sensitive raw body',
    details,
  });
}
describe('investmentApiError', () => {
  it('returns sanitized parsed fields and only explicit missing-permission remediation', () => {
    expect(
      investmentApiError(
        apiError({
          error: {
            code: 'missing_permissions',
            message: '\x1b[2JAccess\rdenied',
            authorization_remediation: {
              authorization_details: [
                { type: 'source', actions: ['read_holdings\x1b[0m'] },
              ],
            },
          },
        }),
        'list holdings',
      ),
    ).toEqual({
      code: 'missing_permissions',
      message: 'Accessdenied',
      cta: {
        commands: [
          {
            command: 'auth upgrade --source-actions read_holdings',
            description: 'Upgrade access after user approval',
          },
        ],
      },
    });
  });
  it.each([
    'holdings_not_supported',
    'holdings_not_ready',
    'holdings_retrieval_failed',
  ])('keeps %s distinct without adding auth guidance', (code) => {
    expect(
      investmentApiError(apiError({ error: { code } }), 'list holdings'),
    ).toEqual({ code, message: code });
  });
  it.each([
    undefined,
    'not JSON',
    { error: { authorization_remediation: 'invalid' } },
  ])('never uses raw-body fallbacks for malformed details: %j', (details) => {
    expect(investmentApiError(apiError(details), 'list holdings')).toEqual({
      code: 'api_error',
      message: 'Failed to list holdings (403)',
    });
  });
  it('discards malformed remediation without a CTA', () => {
    expect(
      investmentApiError(
        apiError({
          error: {
            code: 'missing_permissions',
            authorization_remediation: { scope: 'bad' },
          },
        }),
        'list holdings',
      )?.cta,
    ).toBeUndefined();
  });
  it('leaves unrelated exceptions to normal CLI handling', () =>
    expect(investmentApiError(new Error('local'), 'list holdings')).toBeNull());
  it('preserves safe standard JSON messages even without a server code', () => {
    expect(
      investmentApiError(
        apiError({ error: { message: '\x1b[2JRequest\rdenied' } }),
        'list holdings',
      ),
    ).toEqual({ code: 'api_error', message: 'Requestdenied' });
  });
});
