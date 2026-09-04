import type {
  AuthStorage,
  CreateUcpCheckoutParams,
  IUcpResource,
  SearchUcpCatalogParams,
  UcpCheckout,
  UcpLineItem,
  UcpSearchResult,
} from '@stripe/link-sdk';
import { Cli, z } from 'incur';
import React from 'react';
import { parseKvString } from '../../utils/line-item-parser';
import { renderInteractive } from '../../utils/render-interactive';
import { requireAuth } from '../../utils/require-auth';
import { CatalogSearch } from './catalog-search';
import { CheckoutComplete } from './checkout-complete';
import { CheckoutCreate } from './checkout-create';
import {
  catalogSearchOptions,
  checkoutCompleteOptions,
  checkoutCreateOptions,
} from './schema';

function parseUcpLineItem(item: unknown): UcpLineItem {
  const raw =
    typeof item === 'string'
      ? parseKvString(item)
      : (item as Record<string, unknown>);
  const id = raw.id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('Each line item requires an id');
  }
  const quantity = Number(raw.quantity);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error('Each line item requires a positive integer quantity');
  }
  return { sku_id: id, quantity };
}

export function createUcpCli(
  repositoryFactory: () => IUcpResource,
  authStorage?: AuthStorage,
  envAccessToken?: string,
) {
  const catalog = Cli.create('catalog', {
    description: 'Search the UCP product catalog',
  });

  catalog.command('search', {
    description:
      'Search the Universal Commerce Protocol catalog. --query is always required. Use --test for synthetic demo results.',
    options: catalogSearchOptions,
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage, envAccessToken)],
    async run(c) {
      const opts = c.options;

      if (!opts.query) {
        return c.error({
          code: 'INVALID_INPUT',
          message: 'query is required',
        });
      }

      const params: SearchUcpCatalogParams = {
        query: opts.query,
        profile_id: opts.business,
        sku: opts.id,
        brand: opts.brand.length ? opts.brand : undefined,
        category: opts.category.length ? opts.category : undefined,
        color: opts.color.length ? opts.color : undefined,
        size: opts.size.length ? opts.size : undefined,
        material: opts.material.length ? opts.material : undefined,
        gender: opts.gender.length ? opts.gender : undefined,
        condition: opts.condition.length ? opts.condition : undefined,
        price_min: opts.priceMin,
        price_max: opts.priceMax,
        currency: opts.currency,
        availability: opts.availability,
        sort: opts.sort,
        group_by: opts.groupBy,
        limit: opts.limit,
        offset: opts.offset,
        include_facets: opts.includeFacets || undefined,
        test: opts.test || undefined,
      };

      const repository = repositoryFactory();

      if (!c.agent && !c.formatExplicit) {
        let capturedResult: UcpSearchResult | null = null;
        return renderInteractive(
          <CatalogSearch
            repository={repository}
            params={params}
            onComplete={(result) => {
              capturedResult = result;
            }}
          />,
          () => {
            if (!capturedResult)
              throw new Error('Component exited without producing a result');
            return capturedResult;
          },
        );
      }

      return repository.searchCatalog(params);
    },
  });

  const checkout = Cli.create('checkout', {
    description: 'Create and complete UCP checkout sessions',
  });

  checkout.command('create', {
    description:
      'Create a UCP checkout session for a seller profile and line items. Returns a session in requires_payment with the total to pay. Use --test for a self-consistent demo session.',
    options: checkoutCreateOptions,
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage, envAccessToken)],
    async run(c) {
      const opts = c.options;

      if (!opts.lineItem.length) {
        return c.error({
          code: 'INVALID_INPUT',
          message:
            'At least one --line-item is required (format: "id:sku_123,quantity:1")',
        });
      }

      let lineItems: UcpLineItem[];
      try {
        lineItems = opts.lineItem.map(parseUcpLineItem);
      } catch (err) {
        return c.error({
          code: 'INVALID_INPUT',
          message: (err as Error).message,
        });
      }

      let fulfillmentDetails: Record<string, unknown> | undefined;
      if (opts.fulfillmentDetails !== undefined) {
        try {
          fulfillmentDetails =
            typeof opts.fulfillmentDetails === 'string'
              ? JSON.parse(opts.fulfillmentDetails)
              : (opts.fulfillmentDetails as Record<string, unknown>);
        } catch {
          return c.error({
            code: 'INVALID_INPUT',
            message: '--fulfillment-details must be valid JSON',
          });
        }
      }

      const params: CreateUcpCheckoutParams = {
        profile_id: opts.business,
        line_items: lineItems,
        currency: opts.currency,
        fulfillment_details: fulfillmentDetails,
        test: opts.test || undefined,
      };

      const repository = repositoryFactory();

      if (!c.agent && !c.formatExplicit) {
        let capturedResult: UcpCheckout | null = null;
        return renderInteractive(
          <CheckoutCreate
            repository={repository}
            params={params}
            onComplete={(result) => {
              capturedResult = result;
            }}
          />,
          () => {
            if (!capturedResult)
              throw new Error('Component exited without producing a result');
            return capturedResult;
          },
        );
      }

      const created = await repository.createCheckout(params);
      const testFlag = opts.test ? ' --test' : '';
      return {
        ...created,
        instruction: `Checkout ${created.id} needs payment of ${created.amount_total ?? 'the total'} ${created.currency ?? ''}. Mint a Shared Payment Token for this amount with \`spend-request create --credential-type shared_payment_token --network-id ${opts.business}\`; spend-request calls the UCP business value a network ID. Get it approved, then complete the checkout with the SPT id.`,
        _next: {
          command: `ucp checkout complete ${created.id} --shared-payment-token <spt_id>${testFlag}`,
          until: 'checkout status becomes completed',
        },
      };
    },
  });

  checkout.command('complete', {
    description:
      'Complete a UCP checkout session by confirming it with an approved Shared Payment Token.',
    args: z.object({
      id: z.string().describe('Checkout session ID'),
    }),
    options: checkoutCompleteOptions,
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage, envAccessToken)],
    async run(c) {
      const id = c.args.id;
      const params = {
        shared_payment_token: c.options.sharedPaymentToken,
        test: c.options.test || undefined,
      };

      const repository = repositoryFactory();

      if (!c.agent && !c.formatExplicit) {
        let capturedResult: UcpCheckout | null = null;
        return renderInteractive(
          <CheckoutComplete
            repository={repository}
            id={id}
            params={params}
            onComplete={(result) => {
              capturedResult = result;
            }}
          />,
          () => {
            if (!capturedResult)
              throw new Error('Component exited without producing a result');
            return capturedResult;
          },
        );
      }

      return repository.completeCheckout(id, params);
    },
  });

  const cli = Cli.create('ucp', {
    description:
      'Universal Commerce Protocol (UCP) checkout: search a catalog, create a checkout, and complete it.',
  });
  cli.command(catalog);
  cli.command(checkout);

  return cli;
}
