import { z } from 'incur';

export const catalogSearchOptions = z.object({
  query: z
    .string()
    .max(200)
    .nonempty()
    .describe('Free-text search query (required, max 200 chars)'),
  business: z
    .string()
    .optional()
    .describe('Business target to restrict results to a single seller'),
  id: z.string().optional().describe('Exact SKU ID to look up'),
  brand: z
    .array(z.string())
    .default([])
    .describe('Filter by brand (repeatable)'),
  category: z
    .array(z.string())
    .default([])
    .describe('Filter by category (repeatable)'),
  color: z
    .array(z.string())
    .default([])
    .describe('Filter by color (repeatable)'),
  size: z.array(z.string()).default([]).describe('Filter by size (repeatable)'),
  condition: z
    .array(z.enum(['new', 'used', 'refurbished']))
    .default([])
    .describe('Filter by condition: new, used, or refurbished (repeatable)'),
  priceMin: z.coerce
    .number()
    .int()
    .optional()
    .describe(
      'Minimum price in currency-specific minor units (requires currency)',
    ),
  priceMax: z.coerce
    .number()
    .int()
    .optional()
    .describe(
      'Maximum price in currency-specific minor units (requires currency)',
    ),
  currency: z
    .string()
    .regex(/^[a-z]{3}$/)
    .optional()
    .describe('Supported lowercase three-letter currency code (e.g. usd)'),
  sort: z
    .enum(['relevance', 'price_asc', 'price_desc'])
    .optional()
    .describe('Sort order'),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .default(20)
    .describe('Number of results, 1-20 (default 20)'),
  offset: z.coerce
    .number()
    .int()
    .min(0)
    .max(1000)
    .default(0)
    .describe('Result offset, 0-1000 (default 0)'),
  includeFacets: z
    .boolean()
    .default(false)
    .describe('Include facet aggregations in the response'),
  test: z
    .boolean()
    .default(false)
    .describe(
      'Use demo mode — returns synthetic results without a live search',
    ),
});

const checkoutLineItemOption = z.array(
  z.union([z.string(), z.record(z.string(), z.unknown())]),
);

export const checkoutCreateOptions = z.object({
  business: z.string().trim().nonempty().describe('Business target (required)'),
  lineItem: checkoutLineItemOption
    .default([])
    .describe(
      'Line item (repeatable, key:value format). Keys: id (required), quantity (positive integer, default 1). Example: "id:sku_123,quantity:2"',
    ),
  buyer: z
    .union([z.string(), z.record(z.string(), z.unknown())])
    .optional()
    .describe(
      'Buyer in key:value format or an object. Optional keys: first_name, last_name, email, phone_number. Example: "email:jane@example.com,first_name:Jane"',
    ),
  fulfillment: z
    .union([z.string(), z.record(z.string(), z.unknown())])
    .optional()
    .describe(
      'Entire UCP fulfillment object as a JSON string (CLI) or object (MCP/agent)',
    ),
  fullfilment: z
    .union([z.string(), z.record(z.string(), z.unknown())])
    .optional()
    .describe('Alias for --fulfillment; supply the entire JSON object'),
});

export const checkoutUpdateOptions = checkoutCreateOptions.extend({
  id: z.string().trim().nonempty().optional().describe('Checkout session ID'),
  lineItem: checkoutLineItemOption
    .optional()
    .describe(
      'Line item (repeatable, key:value format). Omit to keep existing items. Keys: id (required), quantity (positive integer, default 1). Example: "id:sku_123,quantity:2"',
    ),
});

export const checkoutCancelOptions = z.object({
  id: z.string().trim().nonempty().optional().describe('Checkout session ID'),
  business: z.string().trim().nonempty().describe('Business target (required)'),
});

export const checkoutCompleteOptions = z.object({
  spendRequestId: z
    .string()
    .trim()
    .nonempty()
    .describe(
      'Approved spend request ID whose shared payment token is resolved by the server (required). Create one with `spend-request create --credential-type shared_payment_token --network-id <business>`, using the same business value passed to UCP',
    ),
  business: z
    .string()
    .trim()
    .nonempty()
    .describe(
      'Business target used to verify the spend request belongs to the same seller profile (required)',
    ),
});

export const checkoutRetrieveOptions = z.object({
  id: z.string().trim().nonempty().optional().describe('Checkout session ID'),
  business: z.string().trim().nonempty().describe('Business target (required)'),
});
