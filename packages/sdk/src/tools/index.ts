import type { z } from 'zod';
import type { Link } from '../client';
import { linkToolSchemas as schemas } from './schemas';

export { linkToolSchemas } from './schemas';

type Defined<T> = T extends readonly (infer Item)[]
  ? Defined<Item>[]
  : T extends object
    ? { [Key in keyof T]: Defined<Exclude<T[Key], undefined>> }
    : T;

// Zod permits explicit undefined on optional inputs; API parameter types do not.
function defined<T>(value: T): Defined<T> {
  if (Array.isArray(value)) return value.map(defined) as Defined<T>;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, defined(item)]),
    ) as Defined<T>;
  }
  return value as Defined<T>;
}

/**
 * Standard Schema tools with no agent-framework dependency. A resolver runs
 * for each execution, so a shared catalog can safely serve multiple users.
 * Credentials are never resolved during tool discovery.
 */
export function createLinkTools<Context = unknown>(
  client: Link | ((context: Context) => Link | Promise<Link>),
) {
  function tool<Schema extends z.ZodType, Output>(
    description: string,
    inputSchema: Schema,
    execute: (link: Link, input: Defined<z.output<Schema>>) => Promise<Output>,
  ) {
    return {
      description,
      inputSchema,
      async execute(input: z.input<Schema>, context: Context): Promise<Output> {
        const params = defined(inputSchema.parse(input));
        const link =
          typeof client === 'function' ? await client(context) : client;
        return execute(link, params);
      },
    };
  }

  return {
    retrieve_user_info: tool(
      'Retrieve the connected Link user profile, wallet limits, and verification requirements.',
      schemas.empty,
      (link) => link.userInfo.retrieve(),
    ),
    list_payment_methods: tool(
      'List saved Link payment methods and identify the default method.',
      schemas.empty,
      (link) => link.paymentMethods.list(),
    ),
    list_shipping_addresses: tool(
      'List the connected Link user’s saved shipping addresses.',
      schemas.empty,
      (link) => link.shippingAddresses.list(),
    ),
    list_spend_requests: tool(
      'List Link spend requests and their current statuses.',
      schemas.listSpendRequests,
      (link, input) =>
        link.spendRequests.list(
          input.include_history === undefined
            ? {}
            : { includeHistory: input.include_history },
        ),
    ),
    create_spend_request: tool(
      'Create a Link spend request for a purchase. Show approval_url to the user; creating a request does not establish approval. Retrieve the same request after approval or required actions.',
      schemas.createSpendRequest,
      (link, input) => link.spendRequests.create(input),
    ),
    retrieve_spend_request: tool(
      'Retrieve a Link spend request, its approval status, and requested credentials. Follow status_details.requires_action instructions; never assume approval from an earlier status.',
      schemas.retrieveSpendRequest,
      (link, { id, ...options }) => link.spendRequests.retrieve(id, options),
    ),
    update_spend_request: tool(
      'Update an existing Link spend request. Check the returned approval status before using credentials.',
      schemas.updateSpendRequest,
      (link, { id, ...params }) => link.spendRequests.update(id, params),
    ),
    request_spend_approval: tool(
      'Request human approval for a Link spend request. Show the returned approval URL to the user.',
      schemas.spendRequestId,
      (link, { id }) => link.spendRequests.requestApproval(id),
    ),
    cancel_spend_request: tool(
      'Cancel a Link spend request.',
      schemas.spendRequestId,
      (link, { id }) => link.spendRequests.cancel(id),
    ),
    list_transactions: tool(
      'List Link transactions. Requires the user’s grant to include access to the requested sources.',
      schemas.listTransactions,
      (link, input) => link.transactions.list(input),
    ),
    list_sources: tool(
      'List connected financial sources available to the Link grant.',
      schemas.listSources,
      (link, input) => link.sources.list(input),
    ),
    list_balances: tool(
      'List balances for financial sources available to the Link grant.',
      schemas.listBalances,
      (link, input) => link.balances.list(input),
    ),
    create_report: tool(
      'Report the outcome of a purchase attempt associated with a Link spend request.',
      schemas.createReport,
      (link, input) => link.reports.create(input),
    ),
  };
}

export type LinkTools<Context = unknown> = ReturnType<
  typeof createLinkTools<Context>
>;
export type LinkToolName = keyof LinkTools;
