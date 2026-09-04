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
  material: z
    .array(z.string())
    .default([])
    .describe('Filter by material (repeatable)'),
  gender: z
    .array(z.string())
    .default([])
    .describe('Filter by gender (repeatable)'),
  condition: z
    .array(z.string())
    .default([])
    .describe('Filter by condition (repeatable)'),
  priceMin: z.coerce
    .number()
    .int()
    .optional()
    .describe('Minimum price in cents'),
  priceMax: z.coerce
    .number()
    .int()
    .optional()
    .describe('Maximum price in cents'),
  currency: z
    .string()
    .length(3)
    .optional()
    .describe('Three-letter ISO currency code'),
  availability: z
    .string()
    .optional()
    .describe('Filter by availability (e.g. in_stock)'),
  sort: z.string().optional().describe('Sort order'),
  groupBy: z.string().optional().describe('Group results by a field'),
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

export const checkoutCreateOptions = z.object({
  business: z.string().describe('Business target (required)'),
  lineItem: z
    .array(z.union([z.string(), z.record(z.string(), z.unknown())]))
    .default([])
    .describe(
      'Line item (repeatable, key:value format). Keys: id (required), quantity (required, positive integer). Example: "id:sku_123,quantity:2"',
    ),
  currency: z
    .string()
    .length(3)
    .default('usd')
    .describe('Three-letter ISO currency code (default usd)'),
  fulfillmentDetails: z
    .union([z.string(), z.record(z.string(), z.unknown())])
    .optional()
    .describe(
      'Fulfillment details as a JSON object (MCP/agent) or JSON string (CLI), e.g. a shipping address',
    ),
  test: z
    .boolean()
    .default(false)
    .describe(
      'Use demo mode — returns a self-consistent session without a live checkout',
    ),
});

export const checkoutCompleteOptions = z.object({
  sharedPaymentToken: z
    .string()
    .describe(
      'Shared Payment Token that authorizes the payment. Mint one with `spend-request create --credential-type shared_payment_token --network-id <business>`, using the same business value passed to UCP, and approve it',
    ),
  test: z
    .boolean()
    .default(false)
    .describe('Use demo mode — confirms the session without a live charge'),
});
