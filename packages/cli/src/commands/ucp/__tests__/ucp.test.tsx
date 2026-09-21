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
      status: 'open',
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
      expect(frame).toContain('open');
      expect(frame).toContain('$55.00 USD');
      expect(frame).toContain('$5.00 USD'); // shipping
      expect(frame).toContain('spend-request create');
      expect(frame).toContain('--credential-type shared_payment_token');
      expect(frame).toContain('--network-id np_1');
      expect(frame).toContain('both --spend-request-id and');
      expect(frame).toContain('--business are required');
      expect(frame).toContain('ucp checkout complete dcs_1');
      expect(frame).toContain('--spend-request-id <SPEND_REQUEST_ID>');
      expect(frame).toContain('--business np_1');
    });
  });
});

describe('ucp checkout complete component', () => {
  it('submits once, verifies the composite state, and renders success', async () => {
    const checkout: UcpCheckout = {
      id: 'dcs_1',
      status: 'completed',
      order_details: { status: 'confirmed' },
    };
    const completeCheckout = vi.fn(async () => checkout);
    const retrieveCheckout = vi.fn(async () => ({
      ...checkout,
      spend_request: {
        id: 'lsrq_1',
        status: 'succeeded' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:01Z',
      },
    }));
    const repo = makeResource({
      completeCheckout,
      retrieveCheckout,
    });

    const { lastFrame } = render(
      <CheckoutComplete
        repository={repo}
        id="dcs_1"
        params={{ spend_request_id: 'lsrq_1', profile_id: 'np_1' }}
        onComplete={() => {}}
      />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('Checkout completed');
      expect(frame).toContain('dcs_1');
      expect(frame).toContain('confirmed');
    });
    expect(completeCheckout).toHaveBeenCalledOnce();
    expect(retrieveCheckout).toHaveBeenCalledWith('dcs_1', {
      spend_request_id: 'lsrq_1',
      test: undefined,
    });
  });

  it('shows 3DS details and polls through an auto-resume action', async () => {
    let resolveFinal: ((value: unknown) => void) | undefined;
    const finalState = new Promise((resolve) => {
      resolveFinal = resolve;
    });
    const actionState = {
      id: 'dcs_1',
      status: 'requires_action' as const,
      spend_request: {
        id: 'lsrq_1',
        status: 'requires_action' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:01Z',
        status_details: {
          requires_action: {
            next_action: {
              type: 'three_d_secure' as const,
              resolution: 'auto_resume' as const,
              display_message: 'Confirm with your bank',
              action_url: 'https://example.com/3ds',
            },
          },
        },
      },
    };
    const successState = {
      id: 'dcs_1',
      status: 'completed' as const,
      order_details: { status: 'confirmed' },
      spend_request: {
        id: 'lsrq_1',
        status: 'succeeded' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:02Z',
      },
    };
    const retrieveCheckout = vi
      .fn()
      .mockResolvedValueOnce(actionState)
      .mockImplementationOnce(() => finalState);
    const repo = makeResource({
      completeCheckout: vi.fn(async () => ({
        id: 'dcs_1',
        status: 'completed' as const,
      })),
      retrieveCheckout,
    });

    const { lastFrame } = render(
      <CheckoutComplete
        repository={repo}
        id="dcs_1"
        params={{ spend_request_id: 'lsrq_1', profile_id: 'np_1' }}
        pollInterval={0.001}
        onComplete={() => {}}
      />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('Waiting for 3D Secure');
      expect(frame).toContain('Confirm with your bank');
      expect(frame).toContain('https://example.com/3ds');
    });

    resolveFinal?.(successState);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Checkout completed');
    });
    expect(retrieveCheckout).toHaveBeenCalledTimes(2);
  });

  it('stops for an action that requires a new spend request', async () => {
    const retrieveCheckout = vi.fn(async () => ({
      id: 'dcs_1',
      status: 'requires_action' as const,
      spend_request: {
        id: 'lsrq_1',
        status: 'requires_action' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:01Z',
        status_details: {
          requires_action: {
            next_action: {
              type: 'update_payment_method' as const,
              resolution: 'create_new_spend_request' as const,
              display_message: 'Choose another card',
              action_url: 'https://example.com/payment-method',
            },
          },
        },
      },
    }));
    const completeCheckout = vi.fn(async () => ({
      id: 'dcs_1',
      status: 'completed' as const,
    }));
    const repo = makeResource({ completeCheckout, retrieveCheckout });

    const { lastFrame } = render(
      <CheckoutComplete
        repository={repo}
        id="dcs_1"
        params={{ spend_request_id: 'lsrq_1', profile_id: 'np_1' }}
        pollInterval={0.001}
        onComplete={() => {}}
      />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('Payment action required');
      expect(frame).toContain('Choose another card');
      expect(frame).toContain('create a new spend request');
    });
    expect(completeCheckout).toHaveBeenCalledOnce();
    expect(retrieveCheckout).toHaveBeenCalledOnce();
  });

  it('shows the latest state when composite polling times out', async () => {
    const repo = makeResource({
      completeCheckout: vi.fn(async () => ({
        id: 'dcs_1',
        status: 'completed' as const,
      })),
      retrieveCheckout: vi.fn(async () => ({
        id: 'dcs_1',
        status: 'completed' as const,
        spend_request: {
          id: 'lsrq_1',
          status: 'approved' as const,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:01Z',
        },
      })),
    });

    const { lastFrame } = render(
      <CheckoutComplete
        repository={repo}
        id="dcs_1"
        params={{ spend_request_id: 'lsrq_1', profile_id: 'np_1' }}
        pollInterval={0.001}
        pollTimeout={0}
        onComplete={() => {}}
      />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('Timed out waiting for checkout payment');
      expect(frame).toContain('ucp checkout retrieve dcs_1');
    });
  });
});
