import type { IPaymentMethodsResource } from '@stripe/link-sdk';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { sanitizeResource } from '../../../utils/resource-factory';
import { PaymentMethodsList } from '../list';

const ESCAPE_PAYLOAD = '\x1b[2JEvil\rHidden';
const CLEAN_TEXT = 'EvilHidden';

describe('payment-methods', () => {
  describe('sanitization', () => {
    it('sanitizes brand and nickname in payment method list', async () => {
      const resource = sanitizeResource({
        listPaymentMethods: vi.fn(async () => [
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
  });
});
