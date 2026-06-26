import { type UcpTransport, UcpResource } from '@stripe/link-sdk';
import { Cli, z } from 'incur';
import {
  businessOption,
  cartCreateOptions,
  cartGetOptions,
  cartUpdateOptions,
  catalogLookupOptions,
  catalogSearchOptions,
  checkoutCompleteOptions,
  checkoutCreateOptions,
  checkoutGetOptions,
  checkoutUpdateOptions,
  orderGetOptions,
} from './schema';

function createUcpResource(
  profileUrl?: string,
  transport?: UcpTransport,
): UcpResource {
  return new UcpResource({ profileUrl: profileUrl ?? '', transport });
}

export function createUcpCli() {
  const cli = Cli.create('ucp', {
    description: 'Universal Commerce Protocol (UCP) commands',
  });

  // --- discover ---

  cli.command('discover', {
    description: 'See what operations a business supports before calling them',
    args: z.object({
      business: z
        .string()
        .describe(
          'Business URL to discover (e.g. https://shop.example.com)',
        ),
    }),
    options: z.object({
      profileUrl: z
        .string()
        .optional()
        .describe('Agent profile URL (not required for discovery, but needed for tool negotiation)'),
    }),
    outputPolicy: 'agent-only' as const,
    async run(c) {
      const resource = createUcpResource(c.options.profileUrl);
      return resource.discover(c.args.business);
    },
  });

  // --- catalog search ---

  const catalogCli = Cli.create('catalog', {
    description:
      'Search for products, enumerate variants and options, check availability',
  });

  catalogCli.command('search', {
    description: 'Search a business catalog over UCP',
    options: catalogSearchOptions,
    outputPolicy: 'agent-only' as const,
    async run(c) {
      const resource = createUcpResource(c.options.profileUrl, c.options.transport);
      return resource.catalogSearch(c.options.business, {
        query: c.options.query,
        limit: c.options.limit,
        cursor: c.options.cursor,
      });
    },
  });

  catalogCli.command('lookup', {
    description: 'Batch lookup products/variants by ID',
    options: catalogLookupOptions,
    outputPolicy: 'agent-only' as const,
    async run(c) {
      const resource = createUcpResource(c.options.profileUrl, c.options.transport);
      const ids = c.options.ids.split(',').map((id) => id.trim());
      return resource.catalogLookup(c.options.business, { ids });
    },
  });

  cli.command(catalogCli);

  // --- cart ---

  const cartCli = Cli.create('cart', {
    description: 'Build a shoppable cart with line items and cost estimates',
  });

  cartCli.command('create', {
    description: 'Create a new cart with line items',
    options: cartCreateOptions,
    outputPolicy: 'agent-only' as const,
    async run(c) {
      const resource = createUcpResource(c.options.profileUrl, c.options.transport);
      if (c.options.input) {
        const parsed = JSON.parse(c.options.input);
        return resource.cartCreate(c.options.business, parsed);
      }
      const lineItems = JSON.parse(c.options.lineItems);
      return resource.cartCreate(c.options.business, {
        line_items: lineItems,
      });
    },
  });

  cartCli.command('get', {
    description: 'Fetch a cart by ID',
    options: cartGetOptions,
    outputPolicy: 'agent-only' as const,
    async run(c) {
      const resource = createUcpResource(c.options.profileUrl, c.options.transport);
      return resource.cartGet(c.options.business, c.options.id);
    },
  });

  cartCli.command('update', {
    description: 'Update an existing cart',
    options: cartUpdateOptions,
    outputPolicy: 'agent-only' as const,
    async run(c) {
      const resource = createUcpResource(c.options.profileUrl, c.options.transport);
      if (c.options.input) {
        const parsed = JSON.parse(c.options.input);
        return resource.cartUpdate(c.options.business, c.options.id, parsed);
      }
      const params: Record<string, unknown> = {};
      if (c.options.lineItems) {
        params.line_items = JSON.parse(c.options.lineItems);
      }
      return resource.cartUpdate(c.options.business, c.options.id, params);
    },
  });

  cli.command(cartCli);

  // --- checkout ---

  const checkoutCli = Cli.create('checkout', {
    description:
      'Complete a purchase, pick fulfillment options, confirm payment',
  });

  checkoutCli.command('create', {
    description:
      'Create a checkout from line_items, or convert a cart with --cart-id',
    options: checkoutCreateOptions,
    outputPolicy: 'agent-only' as const,
    async run(c) {
      const resource = createUcpResource(c.options.profileUrl, c.options.transport);
      if (c.options.input) {
        const parsed = JSON.parse(c.options.input);
        return resource.checkoutCreate(c.options.business, parsed);
      }
      const params: Record<string, unknown> = {};
      if (c.options.cartId) {
        params.cart_id = c.options.cartId;
      }
      if (c.options.lineItems) {
        params.line_items = JSON.parse(c.options.lineItems);
      }
      return resource.checkoutCreate(c.options.business, params);
    },
  });

  checkoutCli.command('get', {
    description: 'Fetch a checkout by ID',
    options: checkoutGetOptions,
    outputPolicy: 'agent-only' as const,
    async run(c) {
      const resource = createUcpResource(c.options.profileUrl, c.options.transport);
      return resource.checkoutGet(c.options.business, c.options.id);
    },
  });

  checkoutCli.command('update', {
    description: 'Update an existing checkout (fulfillment, buyer info, etc.)',
    options: checkoutUpdateOptions,
    outputPolicy: 'agent-only' as const,
    async run(c) {
      const resource = createUcpResource(c.options.profileUrl, c.options.transport);
      const parsed = JSON.parse(c.options.input);
      return resource.checkoutUpdate(c.options.business, c.options.id, parsed);
    },
  });

  checkoutCli.command('complete', {
    description:
      'Complete a checkout and place the order. May return requires_escalation with a continue_url for browser-based payment.',
    options: checkoutCompleteOptions,
    outputPolicy: 'agent-only' as const,
    async run(c) {
      const resource = createUcpResource(c.options.profileUrl, c.options.transport);
      const params = c.options.input ? JSON.parse(c.options.input) : undefined;
      return resource.checkoutComplete(
        c.options.business,
        c.options.id,
        params,
      );
    },
  });

  cli.command(checkoutCli);

  // --- order ---

  const orderCli = Cli.create('order', {
    description:
      'Retrieve order state including fulfillment tracking and delivery status',
  });

  orderCli.command('get', {
    description:
      'Get the current state of an order, including fulfillment expectations, tracking events, and line item status',
    options: orderGetOptions,
    outputPolicy: 'agent-only' as const,
    async run(c) {
      const resource = createUcpResource(c.options.profileUrl, c.options.transport);
      return resource.orderGet(c.options.business, c.options.id);
    },
  });

  cli.command(orderCli);

  return cli;
}
