import type {
  IUcpResource,
  UcpCheckout,
  UcpSearchResult,
} from '@stripe/link-sdk';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { sanitizeResource } from '../../../utils/resource-factory';
import { CatalogSearch } from '../catalog-search';
import { CheckoutComplete } from '../checkout-complete';
import { CheckoutCreate } from '../checkout-create';

const ESCAPE_PAYLOAD = '\x1b[2JEvil\rName';
const CLEAN_TEXT = 'EvilName';

function makeResource(overrides: Partial<IUcpResource>): IUcpResource {
  return sanitizeResource({
    searchCatalog: vi.fn(),
    createCheckout: vi.fn(),
    completeCheckout: vi.fn(),
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
      expect(frame).toContain('$99.00 USD');
      expect(frame).toContain('in_stock');
      // profile_id is surfaced as the business so the agent can create a checkout.
      expect(frame).toContain('np_demo_footwear');
      expect(frame).toContain('Demo Footwear Co');
      expect(frame).toContain(CLEAN_TEXT);
      expect(frame).not.toContain('\x1b[2J');
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
      expect(frame).toContain('$25.00 USD');
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
      expect(frame).toContain('$0.50 USD');
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
      status: 'requires_payment',
      currency: 'usd',
      amount_total: 5500,
      amount_subtotal: 5000,
      total_details: { amount_shipping: 500 },
      line_item_details: [{ sku_id: 'sku_1', quantity: 2, amount_total: 5000 }],
      expires_at: 1_800_000_000,
    };
    const repo = makeResource({ createCheckout: vi.fn(async () => checkout) });

    const { lastFrame } = render(
      <CheckoutCreate
        repository={repo}
        params={{
          profile_id: 'np_1',
          line_items: [{ sku_id: 'sku_1', quantity: 2 }],
        }}
        onComplete={() => {}}
      />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('Checkout created');
      expect(frame).toContain('dcs_1');
      expect(frame).toContain('requires_payment');
      expect(frame).toContain('$55.00 USD');
      expect(frame).toContain('$5.00 USD'); // shipping
      expect(frame).toContain('spend-request create');
      expect(frame).toContain('--credential-type shared_payment_token');
      expect(frame).toContain('--network-id np_1');
      expect(frame).toContain('ucp checkout complete dcs_1');
    });
  });
});

describe('ucp checkout complete component', () => {
  it('renders the completed session with order status', async () => {
    const checkout: UcpCheckout = {
      id: 'dcs_1',
      status: 'completed',
      order_details: { status: 'confirmed' },
    };
    const repo = makeResource({
      completeCheckout: vi.fn(async () => checkout),
    });

    const { lastFrame } = render(
      <CheckoutComplete
        repository={repo}
        id="dcs_1"
        params={{ shared_payment_token: 'spt_1' }}
        onComplete={() => {}}
      />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('Checkout completed');
      expect(frame).toContain('dcs_1');
      expect(frame).toContain('confirmed');
    });
  });
});
