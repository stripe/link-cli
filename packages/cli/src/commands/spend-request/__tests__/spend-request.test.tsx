import {
  type ISpendRequestResource,
  LinkApiError,
  type SpendRequest,
} from '@stripe/link-sdk';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { sanitizeResource } from '../../../utils/resource-factory';
import { CreateSpendRequest } from '../create';
import { RequestApproval } from '../request-approval';
import { RetrieveSpendRequest } from '../retrieve';
import { UpdateSpendRequest } from '../update';

const ESCAPE_PAYLOAD = '\x1b[2JEvil\rHidden';
const CLEAN_TEXT = 'EvilHidden';

function makeSpendRequest(overrides: Partial<SpendRequest> = {}): SpendRequest {
  return {
    id: 'sr_test',
    status: 'approved',
    amount: 1000,
    currency: 'usd',
    merchant_name: ESCAPE_PAYLOAD,
    merchant_url: 'https://example.com',
    context: 'x'.repeat(100),
    credential_type: 'card',
    payment_details: 'pm_1',
    line_items: [{ name: ESCAPE_PAYLOAD }],
    totals: [{ type: 'total', amount: 1000, display_text: 'Total' }],
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    approval_url: '',
    card: undefined,
    shared_payment_token: undefined,
    ...overrides,
  } as SpendRequest;
}

function makeMockRepo(result: SpendRequest) {
  return sanitizeResource({
    createSpendRequest: vi.fn(async () => result),
    getSpendRequest: vi.fn(async () => result),
    updateSpendRequest: vi.fn(async () => result),
    requestApproval: vi.fn(async () => result),
    cancelSpendRequest: vi.fn(async () => result),
  } as unknown as ISpendRequestResource);
}

describe('spend-request', () => {
  describe('verification_url', () => {
    it('CreateSpendRequest surfaces verification_url on additional_verification_required error', async () => {
      const error = new LinkApiError(
        'Consumer must complete additional verification before creating spend requests.',
        {
          status: 403,
          code: 'additional_verification_required',
          details: {
            error: {
              code: 'additional_verification_required',
              message:
                'Consumer must complete additional verification before creating spend requests.',
              verification_url: 'https://app.link.com/finish_setup',
              requirements: [
                {
                  type: 'ssn_collection',
                  field: 'individual.id_number',
                  reason: 'spend_threshold_exceeded',
                },
              ],
            },
          },
        },
      );
      const repo = sanitizeResource({
        createSpendRequest: vi.fn(async () => {
          throw error;
        }),
        getSpendRequest: vi.fn(),
        updateSpendRequest: vi.fn(),
        requestApproval: vi.fn(),
        cancelSpendRequest: vi.fn(),
      } as unknown as ISpendRequestResource);

      const { lastFrame } = render(
        <CreateSpendRequest
          repository={repo}
          params={{
            payment_details: 'pm_1',
            amount: 200100,
            currency: 'usd',
            merchant_name: 'Stripe Press',
            merchant_url: 'https://press.stripe.com',
            context: 'x'.repeat(100),
          }}
          onComplete={() => {}}
        />,
      );

      await vi.waitFor(() => {
        const frame = lastFrame();
        expect(frame).toContain('Failed to create spend request');
        expect(frame).toContain('https://app.link.com/finish_setup');
      });
    });

    it('CreateSpendRequest surfaces support_url on identity_verification_failed error', async () => {
      const error = new LinkApiError(
        'Unable to verify your identity, please reach out to support to re-enable Link for agentic payments.',
        {
          status: 403,
          code: 'identity_verification_failed',
          details: {
            error: {
              code: 'identity_verification_failed',
              message:
                'Unable to verify your identity, please reach out to support to re-enable Link for agentic payments.',
              support_url: 'https://support.link.com',
            },
          },
        },
      );
      const repo = sanitizeResource({
        createSpendRequest: vi.fn(async () => {
          throw error;
        }),
        getSpendRequest: vi.fn(),
        updateSpendRequest: vi.fn(),
        requestApproval: vi.fn(),
        cancelSpendRequest: vi.fn(),
      } as unknown as ISpendRequestResource);

      const { lastFrame } = render(
        <CreateSpendRequest
          repository={repo}
          params={{
            payment_details: 'pm_1',
            amount: 200100,
            currency: 'usd',
            merchant_name: 'Stripe Press',
            merchant_url: 'https://press.stripe.com',
            context: 'x'.repeat(100),
          }}
          onComplete={() => {}}
        />,
      );

      await vi.waitFor(() => {
        const frame = lastFrame();
        expect(frame).toContain('Failed to create spend request');
        expect(frame).toContain('https://support.link.com');
      });
    });

    it('RequestApproval surfaces verification_url on additional_verification_required error', async () => {
      const error = new LinkApiError(
        'Consumer must complete additional verification before creating spend requests.',
        {
          status: 403,
          code: 'additional_verification_required',
          details: {
            error: {
              code: 'additional_verification_required',
              message:
                'Consumer must complete additional verification before creating spend requests.',
              verification_url: 'https://app.link.com/finish_setup',
            },
          },
        },
      );
      const repo = sanitizeResource({
        createSpendRequest: vi.fn(),
        getSpendRequest: vi.fn(),
        updateSpendRequest: vi.fn(),
        requestApproval: vi.fn(async () => {
          throw error;
        }),
        cancelSpendRequest: vi.fn(),
      } as unknown as ISpendRequestResource);

      const { lastFrame } = render(
        <RequestApproval
          repository={repo}
          id="sr_test"
          onComplete={() => {}}
        />,
      );

      await vi.waitFor(() => {
        const frame = lastFrame();
        expect(frame).toContain('Failed to request approval');
        expect(frame).toContain('https://app.link.com/finish_setup');
      });
    });

    it('RequestApproval surfaces support_url on identity_verification_failed error', async () => {
      const error = new LinkApiError(
        'Unable to verify your identity, please reach out to support to re-enable Link for agentic payments.',
        {
          status: 403,
          code: 'identity_verification_failed',
          details: {
            error: {
              code: 'identity_verification_failed',
              message:
                'Unable to verify your identity, please reach out to support to re-enable Link for agentic payments.',
              support_url: 'https://support.link.com',
            },
          },
        },
      );
      const repo = sanitizeResource({
        createSpendRequest: vi.fn(),
        getSpendRequest: vi.fn(),
        updateSpendRequest: vi.fn(),
        requestApproval: vi.fn(async () => {
          throw error;
        }),
        cancelSpendRequest: vi.fn(),
      } as unknown as ISpendRequestResource);

      const { lastFrame } = render(
        <RequestApproval
          repository={repo}
          id="sr_test"
          onComplete={() => {}}
        />,
      );

      await vi.waitFor(() => {
        const frame = lastFrame();
        expect(frame).toContain('Failed to request approval');
        expect(frame).toContain('https://support.link.com');
      });
    });
  });

  describe('sanitization', () => {
    it('CreateSpendRequest sanitizes merchant_name and line_items', async () => {
      const request = makeSpendRequest();
      const repo = makeMockRepo(request);

      const { lastFrame } = render(
        <CreateSpendRequest
          repository={repo}
          params={{
            payment_details: 'pm_1',
            amount: 1000,
            currency: 'usd',
            merchant_name: 'test',
            merchant_url: 'https://example.com',
            context: 'x'.repeat(100),
          }}
          onComplete={() => {}}
        />,
      );

      await vi.waitFor(() => {
        const frame = lastFrame();
        expect(frame).toContain('Merchant');
        expect(frame).toContain(CLEAN_TEXT);
        expect(frame).not.toContain('\x1b[2J');
        expect(frame).not.toContain('\r');
      });
    });

    it('UpdateSpendRequest sanitizes merchant_name and line_items', async () => {
      const request = makeSpendRequest();
      const repo = makeMockRepo(request);

      const { lastFrame } = render(
        <UpdateSpendRequest
          repository={repo}
          id="sr_test"
          params={{ amount: 2000 }}
          onComplete={() => {}}
        />,
      );

      await vi.waitFor(() => {
        const frame = lastFrame();
        expect(frame).toContain('Merchant');
        expect(frame).toContain(CLEAN_TEXT);
        expect(frame).not.toContain('\x1b[2J');
        expect(frame).not.toContain('\r');
      });
    });

    it('RetrieveSpendRequest sanitizes merchant_name, line_items, and billing_address', async () => {
      const request = makeSpendRequest({
        card: {
          id: 'card_1',
          number: '4242424242424242',
          brand: 'visa',
          exp_month: 12,
          exp_year: 2030,
          cvc: '123',
          valid_until: '2025-12-31',
          billing_address: {
            name: ESCAPE_PAYLOAD,
            line1: ESCAPE_PAYLOAD,
            city: 'Test City',
            state: 'TS',
            postal_code: '12345',
            country: 'US',
          },
        },
      });
      const repo = makeMockRepo(request);

      const { lastFrame } = render(
        <RetrieveSpendRequest
          repository={repo}
          id="sr_test"
          onComplete={() => {}}
        />,
      );

      await vi.waitFor(() => {
        const frame = lastFrame();
        expect(frame).toContain('Billing Address');
        expect(frame).toContain(CLEAN_TEXT);
        expect(frame).not.toContain('\x1b[2J');
        expect(frame).not.toContain('\r');
      });
    });
  });
});
