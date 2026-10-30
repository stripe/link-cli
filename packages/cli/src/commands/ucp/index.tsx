import type {
  CreateUcpCheckoutParams,
  IUcpResource,
  SearchUcpCatalogParams,
  UcpCheckout,
  UcpSearchResult,
  UpdateUcpCheckoutParams,
} from '@stripe/link-sdk';
import { Cli, z } from 'incur';
import type { CliAuthStorage } from '../../auth/storage';
import {
  buildCommandContinuation,
  formatCommandSuggestion,
} from '../../utils/command-continuation';
import { renderInteractive } from '../../utils/render-interactive';
import { requireAuth } from '../../utils/require-auth';
import { CatalogSearch } from './catalog-search';
import { CheckoutComplete } from './checkout-complete';
import { CheckoutCreate } from './checkout-create';
import {
  checkoutId,
  parseCheckoutInput,
  parseCheckoutUpdateInput,
} from './checkout-input';
import { runUcpCheckoutRetrieve } from './checkout-state';
import {
  catalogSearchOptions,
  checkoutCompleteOptions,
  checkoutCreateOptions,
  checkoutRetrieveOptions,
  checkoutUpdateOptions,
} from './schema';

export function createUcpCli(
  repositoryFactory: () => IUcpResource,
  authStorage?: CliAuthStorage,
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
        business: opts.business,
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
    description: 'Create, update, retrieve, and complete UCP checkout sessions',
  });

  checkout.command('create', {
    description:
      'Create a UCP checkout for a business and line items. The seller determines currency. Link supplies saved buyer and fulfillment details when those sections are omitted.',
    options: checkoutCreateOptions,
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage, envAccessToken)],
    async run(c) {
      const opts = c.options;

      let params: CreateUcpCheckoutParams;
      try {
        params = parseCheckoutInput(opts);
      } catch (err) {
        return c.error({
          code: 'INVALID_INPUT',
          message: (err as Error).message,
        });
      }

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
      const completion = buildCommandContinuation('ucp', [
        'checkout',
        'complete',
        created.id,
        '--spend-request-id',
        '<spend_request_id>',
        '--business',
        opts.business,
      ]);
      const spendRequest = buildCommandContinuation('spend-request', [
        'create',
        '--credential-type',
        'shared_payment_token',
        '--network-id',
        opts.business,
      ]);
      return {
        ...created,
        instruction: `Review checkout ${created.id}, resolve any messages, and use checkout update to supply any missing details and select fulfillment. On PUT updates, omitted line items, buyer, and fulfillment sections keep their existing checkout values. Once the checkout is ready_for_complete and you have reviewed its final total, create a spend request for that total using ${formatCommandSuggestion(spendRequest)}; spend-request calls the UCP business value a network ID. Get it approved, then complete the checkout. Both \`--spend-request-id\` and \`--business\` are required. Replace only the <spend_request_id> argument in _next.argv with the approved spend request ID, preserving the original business argument, then invoke it directly without a shell.`,
        _next: {
          ...completion,
          until:
            'checkout status is completed and spend request status is succeeded',
        },
      };
    },
  });

  checkout.command('update', {
    description:
      'Update a UCP checkout with PUT. Omitted line items, buyer, and fulfillment sections keep existing checkout values; saved Link wallet details are not reloaded.',
    args: z.object({
      id: z
        .string()
        .trim()
        .nonempty()
        .optional()
        .describe('Checkout session ID'),
    }),
    options: checkoutUpdateOptions,
    middleware: [requireAuth(authStorage, envAccessToken)],
    async run(c) {
      let id: string;
      let params: UpdateUcpCheckoutParams;
      try {
        id = checkoutId(c.args.id, c.options.id);
        params = parseCheckoutUpdateInput(c.options);
      } catch (err) {
        return c.error({
          code: 'INVALID_INPUT',
          message: (err as Error).message,
        });
      }
      return repositoryFactory().updateCheckout(id, params);
    },
  });

  checkout.command('complete', {
    description:
      'Complete a UCP checkout session with an approved spend request for the same business profile. Both --spend-request-id and --business are required.',
    args: z.object({
      id: z.string().trim().nonempty().describe('Checkout session ID'),
    }),
    options: checkoutCompleteOptions,
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage, envAccessToken)],
    async run(c) {
      const id = c.args.id;
      const params = {
        spend_request_id: c.options.spendRequestId,
        business: c.options.business,
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

  checkout.command('retrieve', {
    description:
      'Retrieve a UCP checkout by ID and business. Add --spend-request-id to include payment state, or --poll to wait for a payment outcome.',
    args: z.object({
      id: z
        .string()
        .trim()
        .nonempty()
        .optional()
        .describe('Checkout session ID'),
    }),
    options: checkoutRetrieveOptions,
    middleware: [requireAuth(authStorage, envAccessToken)],
    run(c) {
      let id: string;
      try {
        id = checkoutId(c.args.id, c.options.id);
      } catch (err) {
        return c.error({
          code: 'INVALID_INPUT',
          message: (err as Error).message,
        });
      }
      const repository = repositoryFactory();
      if (!c.options.spendRequestId) {
        return repository.retrieveCheckout(id, {
          business: c.options.business,
        });
      }
      return runUcpCheckoutRetrieve(repository, id, {
        business: c.options.business,
        spendRequestId: c.options.spendRequestId,
        poll: c.options.poll,
        timeout: c.options.timeout,
      });
    },
  });

  const cli = Cli.create('ucp', {
    description:
      'Universal Commerce Protocol (UCP) checkout: search a catalog, create, update, retrieve, and complete a checkout session.',
  });
  cli.command(catalog);
  cli.command(checkout);

  return cli;
}
