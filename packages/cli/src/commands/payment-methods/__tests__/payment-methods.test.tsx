import type { IPaymentMethodsResource } from '@stripe/link-sdk';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { sanitizeResource } from '../../../utils/resource-factory';
import { PaymentMethodsList } from '../list';
import { PaymentMethodRetrieve } from '../retrieve';

const ESCAPE_PAYLOAD = '\x1b[2JEvil\rHidden';
const CLEAN_TEXT = 'EvilHidden';

describe('payment-methods', () => {
  describe('list', () => {
    it('renders Link balance details without a last-four placeholder', async () => {
      const resource = {
        list: vi.fn(async () => [
          {
            id: 'csmrpd_balance',
            type: 'BALANCE',
            name: 'Link balance',
            is_default: false,
            balance_details: {
              available_balance: { amount: 1250, currency: 'usd' },
            },
          },
        ]),
      } as unknown as IPaymentMethodsResource;

      const { lastFrame } = render(
        <PaymentMethodsList resource={resource} onComplete={() => {}} />,
      );

      await vi.waitFor(() => {
        const frame = lastFrame();
        expect(frame).toContain('Link balance $12.50 available');
        expect(frame).not.toContain('undefined');
      });
    });

    it('renders a balance with an unknown available amount', async () => {
      const resource = {
        list: vi.fn(async () => [
          {
            id: 'csmrpd_balance',
            type: 'BALANCE',
            name: 'Link balance',
            is_default: false,
            balance_details: {},
          },
        ]),
      } as unknown as IPaymentMethodsResource;

      const { lastFrame } = render(
        <PaymentMethodsList resource={resource} onComplete={() => {}} />,
      );

      await vi.waitFor(() => {
        const frame = lastFrame();
        expect(frame).toContain('Link balance');
        expect(frame).not.toContain('undefined');
      });
    });
  });

  describe('retrieve', () => {
    it('renders payment-method details and eligibility', async () => {
      const resource = {
        retrieve: vi.fn(async () => ({
          id: 'pd_123',
          type: 'CARD',
          name: 'Visa',
          nickname: 'Personal',
          is_default: true,
          card_details: { brand: 'visa', last4: '4242' },
          capabilities: {
            agentic_payments: {
              eligible: false,
              ineligibility_reasons: ['unsupported'],
            },
          },
        })),
      } as unknown as IPaymentMethodsResource;

      const { lastFrame } = render(
        <PaymentMethodRetrieve
          resource={resource}
          id="pd_123"
          onComplete={() => {}}
        />,
      );

      await vi.waitFor(() => {
        const frame = lastFrame();
        expect(frame).toContain('ID: pd_123');
        expect(frame).toContain('Type: CARD');
        expect(frame).toContain('Name: Visa');
        expect(frame).toContain('Nickname: Personal');
        expect(frame).toContain('Last four: 4242');
        expect(frame).toContain('Default: yes');
        expect(frame).toContain('Agentic payments: ineligible (unsupported)');
      });
    });

    it('renders a missing payment method', async () => {
      const resource = {
        retrieve: vi.fn(async () => null),
      } as unknown as IPaymentMethodsResource;

      const { lastFrame } = render(
        <PaymentMethodRetrieve
          resource={resource}
          id="pd_missing"
          onComplete={() => {}}
        />,
      );

      await vi.waitFor(() => {
        expect(lastFrame()).toContain('Payment method pd_missing not found');
      });
    });
  });

  describe('sanitization', () => {
    it('sanitizes brand and nickname in payment method list', async () => {
      const resource = sanitizeResource({
        list: vi.fn(async () => [
          {
            id: 'pm_1',
            card_details: { brand: ESCAPE_PAYLOAD, last4: '4242' },
            bank_account_details: null,
            nickname: ESCAPE_PAYLOAD,
            is_default: false,
          },
        ]),
      } as unknown as IPaymentMethodsResource);

      const { lastFrame } = render(
        <PaymentMethodsList resource={resource} onComplete={() => {}} />,
      );

      await vi.waitFor(() => {
        const frame = lastFrame();
        expect(frame).toContain(CLEAN_TEXT);
        expect(frame).not.toContain('\x1b[2J');
        expect(frame).not.toContain('\r');
      });
    });

    it('sanitizes fields in a retrieved payment method', async () => {
      const resource = sanitizeResource({
        retrieve: vi.fn(async () => ({
          id: 'pm_1',
          type: 'CARD',
          name: ESCAPE_PAYLOAD,
          nickname: ESCAPE_PAYLOAD,
          is_default: false,
        })),
      } as unknown as IPaymentMethodsResource);

      const { lastFrame } = render(
        <PaymentMethodRetrieve
          resource={resource}
          id="pm_1"
          onComplete={() => {}}
        />,
      );

      await vi.waitFor(() => {
        const frame = lastFrame();
        expect(frame).toContain(CLEAN_TEXT);
        expect(frame).not.toContain('\x1b[2J');
        expect(frame).not.toContain('\r');
      });
    });
  });
});
