import type {
  IUcpResource,
  UcpCheckout,
  UcpSearchResult,
} from '@stripe/link-sdk';
import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sanitizeResource } from '../../../utils/resource-factory';
import { CatalogSearch } from '../catalog-search';
import { CheckoutComplete } from '../checkout-complete';
import { CheckoutCreate } from '../checkout-create';

afterEach(cleanup);

const ESCAPE_PAYLOAD = '\x1b[2JEvil\rName';
const CLEAN_TEXT = 'EvilName';

function makeResource(overrides: Partial<IUcpResource>): IUcpResource {
  return sanitizeResource({
    searchCatalog: vi.fn(),
    createCheckout: vi.fn(),
    completeCheckout: vi.fn(),
    cancelCheckout: vi.fn(),
    retrieveCheckout: vi.fn(),
    ...overrides,
  } as unknown as IUcpResource);
}

describe('ucp catalog search component', () => {
  it('renders products (real sku/title/profile_id shape) with sanitized titles and sale prices', async () => {
    const result: UcpSearchResult = {
      data: [
        {
          sku: 'sku_1',
          title: ESCAPE_PAYLOAD,
          brand: 'Acme',
          price: 12000,
          sale_price: 9900,
          currency: 'usd',
          availability: 'in_stock',
          profile_id: 'np_demo_footwear',
          merchant_name: 'Demo Footwear Co',
        },
      ],
      total_count: 1,
      has_more: false,
    };
    const repo = makeResource({ searchCatalog: vi.fn(async () => result) });

    const { lastFrame } = render(
      <CatalogSearch
        repository={repo}
        params={{ query: 'sneakers' }}
        onComplete={() => {}}
      />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('Catalog results');
      expect(frame).toContain('BUSINESS');
      expect(frame).toContain('sku_1');
      // sale_price is preferred over price.
      expect(frame).toContain('$99.00');
      expect(frame).toContain('in_stock');
      // profile_id is surfaced as the business so the agent can create a checkout.
      expect(frame).toContain('np_demo_footwear');
      expect(frame).toContain('Demo Footwear Co');
      expect(frame).toContain(CLEAN_TEXT);
      expect(frame).not.toContain('\x1b[2J');
    });
  });

  it('formats prices in the currency minor unit', async () => {
    const repo = makeResource({
      searchCatalog: vi.fn(async () => ({
        data: [{ sku: 'sku_jpy', title: 'Tea', price: 1000, currency: 'jpy' }],
        total_count: 1,
      })),
    });

    const { lastFrame } = render(
      <CatalogSearch
        repository={repo}
        params={{ query: 'tea' }}
        onComplete={() => {}}
      />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('¥1,000');
      expect(frame).not.toContain('$10.00');
    });
  });

  it('falls back to sku_id/name when a product uses the legacy demo shape', async () => {
    const repo = makeResource({
      searchCatalog: vi.fn(async () => ({
        data: [{ sku_id: 'sku_legacy', name: 'Legacy Item', price: 2500 }],
        total_count: 1,
      })),
    });

    const { lastFrame } = render(
      <CatalogSearch
        repository={repo}
        params={{ query: 'legacy' }}
        onComplete={() => {}}
      />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('sku_legacy');
      expect(frame).toContain('Legacy Item');
      expect(frame).toContain('$25.00');
    });
  });

  it('falls back to variant fields when sku/price/profile_id/availability live on variants[0] (real grouped-by-product API shape)', async () => {
    const repo = makeResource({
      searchCatalog: vi.fn(async () => ({
        data: [
          {
            id: 'CJPB158377701AZ',
            name: 'Breathable Running Shoes',
            brand: 'Poemusart',
            first_variant_price: { amount: 50, currency: 'usd' },
            variants: [
              {
                merchant_sku: 'CJPB158377701AZ',
                merchant_name: 'Poemusart Inc.',
                profile_id:
                  'profile_61UnURSooufCZI1dNA6UnURR8PSQ9lq8RrWwUUOkq64m',
                price: { amount: 50, currency: 'usd' },
                availability: { status: 'in_stock' },
              },
            ],
          },
        ],
        total_count: 1,
      })),
    });

    const { lastFrame } = render(
      <CatalogSearch
        repository={repo}
        params={{ query: 'running shoes' }}
        onComplete={() => {}}
      />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('CJPB158377701AZ');
      expect(frame).toContain('Breathable Running Shoes');
      expect(frame).toContain('$0.50');
      expect(frame).toContain('in_stock');
      expect(frame).toContain(
        'profile_61UnURSooufCZI1dNA6UnURR8PSQ9lq8RrWwUUOkq64m',
      );
      expect(frame).toContain('Poemusart Inc.');
    });
  });

  it('renders an empty state when there are no products', async () => {
    const repo = makeResource({
      searchCatalog: vi.fn(async () => ({ data: [], total_count: 0 })),
    });

    const { lastFrame } = render(
      <CatalogSearch
        repository={repo}
        params={{ query: 'nothing' }}
        onComplete={() => {}}
      />,
    );

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('No products found');
    });
  });

  it('renders an error state on failure', async () => {
    const repo = makeResource({
      searchCatalog: vi.fn(async () => {
        throw new Error('boom');
      }),
    });

    const { lastFrame } = render(
      <CatalogSearch
        repository={repo}
        params={{ query: 'sneakers' }}
        onComplete={() => {}}
      />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('Catalog search failed');
      expect(frame).toContain('boom');
    });
  });
});

describe('ucp checkout create component', () => {
  it('renders the created session summary and next step', async () => {
    const checkout: UcpCheckout = {
      id: 'dcs_1',
      status: 'ready_for_complete',
      currency: 'usd',
      totals: [
        { type: 'total', amount: 5500 },
        { type: 'subtotal', amount: 5000 },
        { type: 'fulfillment', amount: 500 },
      ],
      line_items: [
        {
          item: { id: 'sku_1' },
          quantity: 2,
          totals: [{ type: 'total', amount: 5000 }],
        },
      ],
      expires_at: '2027-01-15T08:00:00Z',
    };
    const repo = makeResource({ createCheckout: vi.fn(async () => checkout) });

    const { lastFrame } = render(
      <CheckoutCreate
        repository={repo}
        params={{
          business: 'np_1',
          line_items: [{ item: { id: 'sku_1' }, quantity: 2 }],
        }}
        onComplete={() => {}}
      />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('Checkout created');
      expect(frame).toContain('dcs_1');
      expect(frame).toContain('ready_for_complete');
      expect(frame).toContain('$55.00');
      expect(frame).toContain('$5.00'); // shipping
      expect(frame).toContain('sku_1 ×2');
      expect(frame).toContain('Expires: 2027-01-15T08:00:00Z');
      expect(frame).toContain('checkout update');
      expect(frame).toContain('spend-request create');
      expect(frame).toContain('--credential-type shared_payment_token');
      expect(frame).toContain('--network-id np_1');
      expect(frame).toContain('both --spend-request-id and');
      expect(frame).toContain('--business are required');
      expect(frame).toContain('ucp checkout complete dcs_1');
      expect(frame).toContain("--spend-request-id '<spend_request_id>'");
      expect(frame).toContain('--business np_1');
    });
  });
});

describe('ucp checkout summary currency formatting', () => {
  it('formats amounts in the currency minor unit', async () => {
    const checkout: UcpCheckout = {
      id: 'dcs_jpy',
      status: 'ready_for_complete',
      currency: 'jpy',
      totals: [{ type: 'total', amount: 1000 }],
    };
    const repo = makeResource({ createCheckout: vi.fn(async () => checkout) });

    const { lastFrame } = render(
      <CheckoutCreate
        repository={repo}
        params={{
          business: 'np_1',
          line_items: [{ item: { id: 'sku_1' }, quantity: 1 }],
        }}
        onComplete={() => {}}
      />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('¥1,000');
      expect(frame).not.toContain('$10.00');
    });
  });
});

describe('ucp checkout complete component', () => {
  it.each([
    'completed',
    'complete_in_progress',
    'requires_escalation',
  ] as const)(
    'returns the completion API response for %s without follow-up retrieval',
    async (status) => {
      const checkout: UcpCheckout = {
        id: 'dcs_1',
        status,
        order: { id: 'order_confirmed' },
        messages: [{ content: 'Review order' }],
        custom_metadata: { preserved: true },
      };
      const completeCheckout = vi.fn(async () => checkout);
      const retrieveCheckout = vi
        .fn()
        .mockRejectedValue(new Error('Unexpected retrieval'));
      const onComplete = vi.fn();
      const { lastFrame } = render(
        <CheckoutComplete
          repository={makeResource({ completeCheckout, retrieveCheckout })}
          id="dcs_1"
          params={{ spend_request_id: 'lsrq_1', business: 'np_1' }}
          onComplete={onComplete}
        />,
      );
      await vi.waitFor(() => {
        expect(lastFrame()).toContain('Checkout completion response received');
        expect(lastFrame()).toContain(status);
        expect(lastFrame()).toContain('order_confirmed');
      });
      await vi.waitFor(
        () => expect(onComplete).toHaveBeenCalledExactlyOnceWith(checkout),
        { timeout: 2500 },
      );
      expect(completeCheckout).toHaveBeenCalledExactlyOnceWith('dcs_1', {
        spend_request_id: 'lsrq_1',
        business: 'np_1',
      });
      expect(retrieveCheckout).not.toHaveBeenCalled();
      expect(lastFrame()).not.toMatch(
        /payment succeeded|Checkout completed|Verifying/,
      );
    },
  );

  it('surfaces the completion API error without retrieving checkout', async () => {
    const completeCheckout = vi
      .fn()
      .mockRejectedValue(new Error('Your card was declined.'));
    const retrieveCheckout = vi.fn();
    const onComplete = vi.fn();
    const { lastFrame } = render(
      <CheckoutComplete
        repository={makeResource({ completeCheckout, retrieveCheckout })}
        id="dcs_1"
        params={{ spend_request_id: 'lsrq_1', business: 'np_1' }}
        onComplete={onComplete}
      />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Failed to complete checkout');
      expect(lastFrame()).toContain('Your card was declined.');
    });
    await vi.waitFor(
      () => expect(onComplete).toHaveBeenCalledExactlyOnceWith(null),
      { timeout: 2500 },
    );
    expect(completeCheckout).toHaveBeenCalledOnce();
    expect(retrieveCheckout).not.toHaveBeenCalled();
  });
});
