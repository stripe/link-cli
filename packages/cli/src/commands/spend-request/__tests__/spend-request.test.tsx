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
    create: vi.fn(async () => result),
    retrieve: vi.fn(async () => result),
    update: vi.fn(async () => result),
    requestApproval: vi.fn(async () => result),
    cancel: vi.fn(async () => result),
  } as unknown as ISpendRequestResource);
}

// Returns each entry in `getSpendRequestResults` in order on successive
// `retrieve` calls (repeating the last entry once exhausted), so tests
// can simulate a status transitioning across polls.
function makeSequentialMockRepo(
  createResult: SpendRequest,
  getSpendRequestResults: SpendRequest[],
) {
  let call = 0;
  const retrieve = vi.fn(async () => {
    const result =
      getSpendRequestResults[Math.min(call, getSpendRequestResults.length - 1)];
    call++;
    return result;
  });
  return sanitizeResource({
    create: vi.fn(async () => createResult),
    retrieve,
    update: vi.fn(async () => createResult),
    requestApproval: vi.fn(async () => ({
      id: createResult.id,
      approval_link: 'https://app.link.com/approve/sr_test',
    })),
    cancel: vi.fn(async () => createResult),
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
        create: vi.fn(async () => {
          throw error;
        }),
        retrieve: vi.fn(),
        update: vi.fn(),
        requestApproval: vi.fn(),
        cancel: vi.fn(),
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
        expect(frame).toContain('Press Enter to open in browser');
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
        create: vi.fn(async () => {
          throw error;
        }),
        retrieve: vi.fn(),
        update: vi.fn(),
        requestApproval: vi.fn(),
        cancel: vi.fn(),
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
        expect(frame).toContain('Press Enter to open in browser');
      });
    });

    it('CreateSpendRequest surfaces the duplicate spend request on spend_request_rate_limited error', async () => {
      const error = new LinkApiError(
        'Failed to create spend request (429): You cannot submit duplicate spend requests within a short period of time.',
        {
          status: 429,
          code: 'api_error',
          details: {
            error: {
              code: 'spend_request_rate_limited',
              message:
                'You cannot submit duplicate spend requests within a short period of time.',
              retry_after: 1699999999,
              duplicate_spend_request: {
                id: 'sr_duplicate',
                status: 'created',
                amount: 5000,
                currency: 'usd',
                merchant_name: ESCAPE_PAYLOAD,
                context: 'x'.repeat(100),
                payment_details: 'pm_1',
                line_items: [],
                totals: [],
                created_at: '2025-01-01T00:00:00Z',
                updated_at: '2025-01-01T00:00:00Z',
              },
            },
          },
        },
      );
      const repo = sanitizeResource({
        create: vi.fn(async () => {
          throw error;
        }),
        retrieve: vi.fn(),
        update: vi.fn(),
        requestApproval: vi.fn(),
        cancel: vi.fn(),
      } as unknown as ISpendRequestResource);

      const { lastFrame } = render(
        <CreateSpendRequest
          repository={repo}
          params={{
            payment_details: 'pm_1',
            amount: 5000,
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
        expect(frame).toContain('A matching spend request already exists');
        expect(frame).toContain('sr_duplicate');
        expect(frame).toContain('spend-request retrieve sr_duplicate');
        // Duplicate fields are sanitized before rendering.
        expect(frame).toContain(CLEAN_TEXT);
        expect(frame).not.toContain('\x1b[2J');
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
        create: vi.fn(),
        retrieve: vi.fn(),
        update: vi.fn(),
        requestApproval: vi.fn(async () => {
          throw error;
        }),
        cancel: vi.fn(),
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
        expect(frame).toContain('Press Enter to open in browser');
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
        create: vi.fn(),
        retrieve: vi.fn(),
        update: vi.fn(),
        requestApproval: vi.fn(async () => {
          throw error;
        }),
        cancel: vi.fn(),
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
        expect(frame).toContain('Press Enter to open in browser');
      });
    });
  });

  describe('requires_action', () => {
    it('CreateSpendRequest shows next_action details for a non-auto_resume type', async () => {
      const request = makeSpendRequest({
        status: 'requires_action',
        status_details: {
          requires_action: {
            next_action: {
              type: 'add_payment_method',
              resolution: 'create_new_spend_request',
              display_message: 'Add a payment method to continue.',
              action_url: 'https://app.link.com/add_payment_method',
            },
          },
        },
      });
      const repo = makeMockRepo(request);

      const { lastFrame } = render(
        <CreateSpendRequest
          repository={repo}
          params={{
            payment_details: 'pm_1',
            amount: 1000,
            currency: 'usd',
            merchant_name: 'Acme',
            merchant_url: 'https://example.com',
            context: 'x'.repeat(100),
          }}
          onComplete={() => {}}
        />,
      );

      await vi.waitFor(() => {
        const frame = lastFrame();
        expect(frame).toContain('Action required before payment can proceed');
        expect(frame).toContain('add_payment_method');
        expect(frame).toContain('Add a payment method to continue.');
        expect(frame).toContain('https://app.link.com/add_payment_method');
        expect(frame).toContain('Press Enter to open in browser');
        expect(frame).toContain(
          'Complete this step, then create a new spend request.',
        );
      });
    });

    it('CreateSpendRequest resumes polling for auto_resume (three_d_secure) and resolves to success', async () => {
      const requiresAction = makeSpendRequest({
        status: 'requires_action',
        status_details: {
          requires_action: {
            next_action: {
              type: 'three_d_secure',
              resolution: 'auto_resume',
              display_message: 'Complete 3D Secure verification.',
              action_url: 'https://app.link.com/finish_setup?verify=3ds',
            },
          },
        },
      });
      const approved = makeSpendRequest({ status: 'approved' });
      const repo = makeSequentialMockRepo(requiresAction, [approved]);

      const { lastFrame } = render(
        <CreateSpendRequest
          repository={repo}
          params={{
            payment_details: 'pm_1',
            amount: 1000,
            currency: 'usd',
            merchant_name: 'Acme',
            merchant_url: 'https://example.com',
            context: 'x'.repeat(100),
          }}
          onComplete={() => {}}
        />,
      );

      await vi.waitFor(
        () => {
          const frame = lastFrame();
          expect(frame).toContain(
            'Waiting for 3D Secure verification to complete',
          );
        },
        { timeout: 3000 },
      );

      await vi.waitFor(
        () => {
          const frame = lastFrame();
          expect(frame).toContain('Spend request created');
          expect(frame).toContain('approved');
        },
        { timeout: 5000 },
      );
    }, 8000);

    it('CreateSpendRequest surfaces requires_action reached via --request-approval polling (not conflated with denied)', async () => {
      const created = makeSpendRequest({
        status: 'created',
        approval_url: 'https://app.link.com/approve/sr_test',
      });
      const requiresAction = makeSpendRequest({
        status: 'requires_action',
        status_details: {
          requires_action: {
            next_action: {
              type: 're_authorize',
              resolution: 'create_new_spend_request',
              display_message: 'Re-authorize this payment method.',
              action_url: null,
            },
          },
        },
      });
      const repo = makeSequentialMockRepo(created, [requiresAction]);

      const { lastFrame } = render(
        <CreateSpendRequest
          repository={repo}
          params={{
            payment_details: 'pm_1',
            amount: 1000,
            currency: 'usd',
            merchant_name: 'Acme',
            merchant_url: 'https://example.com',
            context: 'x'.repeat(100),
          }}
          requestApproval
          onComplete={() => {}}
        />,
      );

      await vi.waitFor(
        () => {
          const frame = lastFrame();
          expect(frame).toContain('Action required before payment can proceed');
          expect(frame).toContain('re_authorize');
          expect(frame).toContain('Re-authorize this payment method.');
          expect(frame).not.toContain('denied');
        },
        { timeout: 3000 },
      );
    });

    it('RequestApproval shows a minimal requires_action message reached via polling', async () => {
      const requiresAction = makeSpendRequest({
        status: 'requires_action',
        status_details: {
          requires_action: {
            next_action: {
              type: 'update_payment_method',
              resolution: 'create_new_spend_request',
              display_message: 'Update your payment method.',
              action_url: 'https://app.link.com/update_payment_method',
            },
          },
        },
      });
      const repo = makeSequentialMockRepo(requiresAction, [requiresAction]);

      const { lastFrame } = render(
        <RequestApproval
          repository={repo}
          id="sr_test"
          onComplete={() => {}}
        />,
      );

      await vi.waitFor(
        () => {
          const frame = lastFrame();
          expect(frame).toContain('Action required before payment can proceed');
          expect(frame).toContain('Update your payment method.');
          expect(frame).toContain('https://app.link.com/update_payment_method');
          expect(frame).not.toContain('denied');
        },
        { timeout: 3000 },
      );
    });

    it('RetrieveSpendRequest shows the requires_action phase for a non-auto_resume type', async () => {
      const request = makeSpendRequest({
        status: 'requires_action',
        status_details: {
          requires_action: {
            next_action: {
              type: 'select_payment_method',
              resolution: 'create_new_spend_request',
              display_message: 'Select a different payment method.',
              action_url: 'https://app.link.com/select_payment_method',
            },
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
        expect(frame).toContain('Action required before payment can proceed');
        expect(frame).toContain('select_payment_method');
        expect(frame).toContain('Select a different payment method.');
        expect(frame).toContain('https://app.link.com/select_payment_method');
        expect(frame).toContain(
          'Complete this step, then create a new spend request.',
        );
      });
    });

    it('RetrieveSpendRequest polls through an auto_resume requires_action and resolves to success', async () => {
      const requiresAction = makeSpendRequest({
        status: 'requires_action',
        status_details: {
          requires_action: {
            next_action: {
              type: 'three_d_secure',
              resolution: 'auto_resume',
              display_message: 'Complete 3D Secure verification.',
              action_url: 'https://app.link.com/finish_setup?verify=3ds',
            },
          },
        },
      });
      const approved = makeSpendRequest({ status: 'approved' });
      const repo = makeSequentialMockRepo(requiresAction, [
        requiresAction,
        approved,
      ]);

      const { lastFrame } = render(
        <RetrieveSpendRequest
          repository={repo}
          id="sr_test"
          onComplete={() => {}}
        />,
      );

      await vi.waitFor(() => {
        const frame = lastFrame();
        expect(frame).toContain(
          'Waiting for 3D Secure verification to complete',
        );
      });

      await vi.waitFor(
        () => {
          const frame = lastFrame();
          expect(frame).toContain('Spend request approved');
        },
        { timeout: 5000 },
      );
    }, 8000);
  });

  describe('activity_url', () => {
    it('RetrieveSpendRequest shows activity_url in finalized phase', async () => {
      const request = makeSpendRequest({
        status: 'succeeded',
        activity_url: 'https://activity.link.com/tx_123',
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
        expect(frame).toContain('Activity URL');
        expect(frame).toContain('https://activity.link.com/tx_123');
      });
    });

    it('RetrieveSpendRequest shows link_transaction_id in finalized phase', async () => {
      const request = makeSpendRequest({
        status: 'succeeded',
        link_transaction_id: 'ltxn_abc123',
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
        expect(frame).toContain('Transaction ID');
        expect(frame).toContain('ltxn_abc123');
      });
    });

    it('RetrieveSpendRequest omits activity_url on failed status even when present', async () => {
      const request = makeSpendRequest({
        status: 'failed',
        activity_url: 'https://activity.link.com/tx_123',
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
        expect(frame).toContain('terminal status');
        expect(frame).not.toContain('Activity URL');
      });
    });

    it('RetrieveSpendRequest omits activity_url when absent in finalized phase', async () => {
      const request = makeSpendRequest({ status: 'succeeded' });
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
        expect(frame).toContain('terminal status');
        expect(frame).not.toContain('Activity URL');
      });
    });
  });

  describe('card summary', () => {
    it('RetrieveSpendRequest shows card_brand and card_last4 when full card is not expanded', async () => {
      const request = makeSpendRequest({
        merchant_name: 'Acme',
        card_brand: 'visa',
        card_last4: '4242',
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
        expect(frame).toContain('Card:');
        expect(frame).toContain('visa');
        expect(frame).toContain('····4242');
      });
    });

    it('RetrieveSpendRequest hides the card summary when the full card is expanded', async () => {
      const request = makeSpendRequest({
        merchant_name: 'Acme',
        card_brand: 'visa',
        card_last4: '4242',
        card: {
          id: 'ic_1',
          brand: 'visa',
          exp_month: 12,
          exp_year: 2030,
          number: '4242424242424242',
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
        expect(frame).toContain('Card Details:');
        expect(frame).not.toContain('····4242');
      });
    });

    it('RetrieveSpendRequest omits the card summary for SPT (no brand/last4)', async () => {
      const request = makeSpendRequest({
        merchant_name: 'Acme',
        credential_type: 'shared_payment_token',
        card_brand: undefined,
        card_last4: undefined,
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
        expect(frame).toContain('Spend request approved');
        expect(frame).not.toContain('Card:');
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
          number: '4000009990001984',
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
