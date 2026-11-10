import type { UcpCheckout } from '@stripe/link-sdk';
import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { CheckoutSummary } from '../checkout-summary';

const checkout: UcpCheckout = {
  id: 'checkout_1',
  currency: 'usd',
  buyer: {
    first_name: 'Jane',
    last_name: 'Doe',
    email: 'jane@example.com',
    phone_number: '+15555550123',
  },
  fulfillment: {
    methods: [
      {
        id: 'shipping_1',
        type: 'shipping',
        selected_destination_id: 'destination_2',
        destinations: [
          { id: 'destination_1', street_address: 'Unselected address' },
          {
            id: 'destination_2',
            first_name: 'Jane',
            last_name: 'Doe',
            street_address: '123 Main St',
            extended_address: 'Apt 2',
            address_locality: 'Springfield',
            address_region: 'IL',
            postal_code: '62701',
            address_country: 'US',
            phone_number: '+15555550123',
          },
        ],
        groups: [
          {
            id: 'group_1',
            selected_option_id: 'standard',
            options: [
              {
                id: 'express',
                title: 'Unselected express',
                totals: [{ type: 'total', amount: 1200 }],
              },
              {
                id: 'standard',
                title: 'Standard shipping',
                totals: [{ type: 'total', amount: 500 }],
              },
            ],
          },
        ],
      },
    ],
  },
};

afterEach(cleanup);

describe('checkout details', () => {
  it('does not list unselected fulfillment methods alongside a selected method', () => {
    const methods = checkout.fulfillment?.methods as Record<string, unknown>[];
    const { lastFrame } = render(
      <CheckoutSummary
        checkout={{
          ...checkout,
          fulfillment: {
            methods: [
              ...methods,
              {
                id: 'unselected_pickup',
                type: 'pickup',
                destinations: [
                  { id: 'store_1', street_address: 'Hidden store address' },
                ],
              },
            ],
          },
        }}
      />,
    );
    expect(lastFrame()).toContain('shipping_1');
    expect(lastFrame()).not.toContain('unselected_pickup');
    expect(lastFrame()).not.toContain('pickup');
    expect(lastFrame()).not.toContain('store_1');
    expect(lastFrame()).not.toContain('Hidden store address');
  });
  it('shows the buyer and only explicitly selected fulfillment details', () => {
    const { lastFrame } = render(<CheckoutSummary checkout={checkout} />);
    const frame = lastFrame();
    for (const value of [
      'Buyer:',
      'Jane Doe',
      'jane@example.com',
      '+15555550123',
      'Method: shipping (ID: shipping_1)',
      'Selected destination ID: destination_2',
      '123 Main St',
      'Apt 2',
      'Springfield',
      'IL',
      '62701',
      'US',
      'Fulfillment group ID: group_1',
      'Selected option: Standard shipping (ID: standard)',
      '$5.00',
    ])
      expect(frame).toContain(value);
    for (const value of [
      'destination_1',
      'Unselected address',
      'express',
      'Unselected express',
      '$12.00',
    ])
      expect(frame).not.toContain(value);
  });

  it('does not assume a single available destination or option is selected', () => {
    const { lastFrame } = render(
      <CheckoutSummary
        checkout={{
          id: 'checkout_1',
          fulfillment: {
            methods: [
              {
                type: 'shipping',
                destinations: [
                  {
                    id: 'unselected_destination',
                    street_address: 'Hidden address',
                  },
                ],
                groups: [
                  {
                    options: [
                      { id: 'unselected_option', title: 'Hidden option' },
                    ],
                  },
                ],
              },
            ],
          },
        }}
      />,
    );
    expect(lastFrame()).toContain('No destination selected');
    expect(lastFrame()).toContain('No shipping option selected');
    expect(lastFrame()).not.toContain('Hidden');
    expect(lastFrame()).not.toContain('unselected_');
  });

  it('shows selected IDs when the seller does not return their details', () => {
    const { lastFrame } = render(
      <CheckoutSummary
        checkout={{
          id: 'checkout_1',
          fulfillment: {
            methods: [
              {
                type: 'pickup',
                selected_destination_id: 'store_1',
                groups: [{ selected_option_id: 'pickup_1' }],
              },
            ],
          },
        }}
      />,
    );
    expect(lastFrame()).toContain('Selected destination ID: store_1');
    expect(lastFrame()).toContain('Selected option (ID: pickup_1)');
  });

  it('shows absent buyer and fulfillment details explicitly', () => {
    const { lastFrame } = render(
      <CheckoutSummary checkout={{ id: 'checkout_1' }} />,
    );
    expect(lastFrame()).toContain('Buyer:\n    Not provided');
    expect(lastFrame()).toContain('Fulfillment:\n    Not provided');
  });

  it('displays message types, codes, content, paths, severity and recovery URLs', () => {
    const { lastFrame } = render(
      <CheckoutSummary
        checkout={{
          id: 'checkout_1',
          messages: [
            {
              type: 'error',
              code: 'missing_shipping_option',
              content: 'Select shipping',
              path: '$.fulfillment.methods[0]',
              severity: 'recoverable',
              url: 'https://example.com/fix',
            },
            {
              type: 'warning',
              code: 'price_changed',
              content: 'Review the price',
            },
            { type: 'info', content: 'Delivery confirmed' },
          ],
          continue_url: 'https://example.com/continue',
        }}
      />,
    );
    for (const value of [
      'ERROR [missing_shipping_option]',
      '(recoverable)',
      'Select shipping',
      '$.fulfillment.methods[0]',
      'https://example.com/fix',
      'WARNING [price_changed]',
      'Review the price',
      'INFO',
      'Delivery confirmed',
      'Continue: https://example.com/continue',
    ])
      expect(lastFrame()).toContain(value);
  });

  it('renders unfamiliar messages and ignores malformed fulfillment entries safely', () => {
    const { lastFrame } = render(
      <CheckoutSummary
        checkout={{
          id: 'checkout_1',
          messages: [
            'Seller notice',
            null,
            { code: 'future', details: { reason: 'Review needed' } },
          ],
          fulfillment: {
            methods: [null, { destinations: [null], groups: [null] }],
          },
        }}
      />,
    );
    expect(lastFrame()).toContain('Seller notice');
    expect(lastFrame()).toContain('Review needed');
    expect(lastFrame()).toContain('No destination selected');
  });
});
