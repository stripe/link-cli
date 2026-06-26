import { z } from 'incur';

export const businessOption = z.object({
  business: z
    .string()
    .describe(
      'Business URL to interact with (e.g. https://ucp-demo.myshopify.com)',
    ),
  profileUrl: z
    .string()
    .describe(
      'Agent profile URL that identifies this agent to the merchant',
    ),
});

export const catalogSearchOptions = businessOption.extend({
  query: z.string().describe('Free-text search query (e.g. "boots")'),
  limit: z.number().optional().describe('Maximum number of results to return'),
  cursor: z
    .string()
    .optional()
    .describe('Pagination cursor from a prior response'),
});

export const catalogLookupOptions = businessOption.extend({
  ids: z
    .string()
    .describe('Comma-separated list of product/variant IDs to look up'),
});

export const cartCreateOptions = businessOption.extend({
  lineItems: z
    .string()
    .describe(
      'Line items as JSON array (e.g. \'[{"variant_id":"gid://123","quantity":1}]\')',
    ),
  input: z
    .string()
    .optional()
    .describe('Full operation payload as JSON (overrides other fields)'),
});

export const cartGetOptions = businessOption.extend({
  id: z.string().describe('Cart ID'),
});

export const cartUpdateOptions = businessOption.extend({
  id: z.string().describe('Cart ID'),
  lineItems: z.string().optional().describe('Updated line items as JSON array'),
  input: z
    .string()
    .optional()
    .describe('Full operation payload as JSON (overrides other fields)'),
});

export const checkoutCreateOptions = businessOption.extend({
  cartId: z.string().optional().describe('Cart ID to convert to checkout'),
  lineItems: z
    .string()
    .optional()
    .describe('Line items as JSON array (alternative to --cart-id)'),
  input: z
    .string()
    .optional()
    .describe('Full operation payload as JSON (overrides other fields)'),
});

export const checkoutGetOptions = businessOption.extend({
  id: z.string().describe('Checkout ID'),
});

export const checkoutUpdateOptions = businessOption.extend({
  id: z.string().describe('Checkout ID'),
  input: z.string().describe('Update payload as JSON'),
});

export const checkoutCompleteOptions = businessOption.extend({
  id: z.string().describe('Checkout ID'),
  input: z
    .string()
    .optional()
    .describe('Complete payload as JSON (e.g. payment method details)'),
});
