import { z } from 'incur';

export const createOptions = z.object({
  paymentMethodId: z.string().describe('Payment method ID'),
  credentialType: z
    .enum(['shared_payment_token', 'card'])
    .default('card')
    .describe(
      '"card" for checkout forms/Stripe Elements; "shared_payment_token" for HTTP 402/machine payment flows',
    ),
  networkId: z
    .string()
    .optional()
    .describe(
      'Network ID (required for shared_payment_token) — use `link-cli mpp decode` to extract',
    ),
  amount: z.coerce
    .number()
    .int()
    .positive()
    .max(50000)
    .describe('Amount in cents, max 50000 ($500.00)'),
  currency: z.string().length(3).default('usd').describe('Currency code'),
  merchantName: z
    .string()
    .optional()
    .describe(
      'Merchant name (required for card; forbidden for shared_payment_token)',
    ),
  merchantUrl: z
    .string()
    .optional()
    .describe(
      'Merchant URL (required for card; forbidden for shared_payment_token)',
    ),
  context: z
    .string()
    .min(100)
    .describe(
      'Min 100 chars — describe the purchase and rationale; the user reads this when approving',
    ),
  lineItem: z
    .array(z.union([z.string(), z.record(z.string(), z.unknown())]))
    .default([])
    .describe('Line item (repeatable, key:value format)'),
  total: z
    .array(z.union([z.string(), z.record(z.string(), z.unknown())]))
    .default([])
    .describe('Total (repeatable, key:value format)'),
  requestApproval: z
    .boolean()
    .default(true)
    .describe('Request approval and poll until approved/denied/expired'),
  test: z
    .boolean()
    .default(false)
    .describe(
      'Use test mode (creates testmode credentials from test card data)',
    ),
});

export const retrieveOptions = z.object({
  timeout: z.coerce
    .number()
    .default(300)
    .describe('Polling timeout in seconds'),
  interval: z.coerce
    .number()
    .default(0)
    .describe(
      'Poll interval in seconds. When > 0, polls until status is terminal or timeout is reached, yielding status on each attempt.',
    ),
  maxAttempts: z.coerce
    .number()
    .default(0)
    .describe('Max poll attempts. 0 = unlimited (use timeout instead).'),
  include: z
    .array(z.string())
    .default([])
    .describe('Include extra data (repeatable, e.g. --include card)'),
});

export const updateOptions = z.object({
  paymentMethodId: z.string().optional().describe('Payment method ID'),
  amount: z.coerce.number().optional().describe('Amount in cents'),
  merchantUrl: z.string().optional().describe('Merchant URL'),
  profileId: z.string().optional().describe('Profile ID'),
  merchantId: z.string().optional().describe('Merchant ID'),
  currency: z.string().optional().describe('Currency code'),
  lineItem: z
    .array(z.union([z.string(), z.record(z.string(), z.unknown())]))
    .default([])
    .describe('Line item (repeatable, key:value format)'),
  total: z
    .array(z.union([z.string(), z.record(z.string(), z.unknown())]))
    .default([])
    .describe('Total (repeatable, key:value format)'),
});
