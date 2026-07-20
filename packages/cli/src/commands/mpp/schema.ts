import { z } from 'incur';

export const payOptions = z.object({
  spendRequestId: z
    .string()
    .optional()
    .describe(
      'Approved spend request ID with credential_type "shared_payment_token". If omitted, the command handles the full flow: probe URL, parse challenge, create spend request, get approval, and pay.',
    ),
  method: z
    .string()
    .optional()
    .describe('HTTP method (default: GET, or POST if --data is provided)'),
  data: z
    .string()
    .optional()
    .describe('Request body (implies POST if --method is not set)'),
  header: z
    .array(z.string())
    .default([])
    .describe('Request header in "Name: Value" format (repeatable)'),
  context: z
    .string()
    .min(100)
    .optional()
    .describe(
      'Min 100 chars — describe the purchase and rationale; the user reads this when approving. Required when --spend-request-id is not provided.',
    ),
  amount: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Amount in cents (derived from 402 challenge if omitted; required if challenge has no amount)',
    ),
  paymentMethodId: z
    .string()
    .optional()
    .describe('Payment method ID (uses default if omitted)'),
  test: z
    .boolean()
    .default(false)
    .describe(
      'Use test mode (creates testmode credentials from test card data)',
    ),
});

export const decodeOptions = z.object({
  challenge: z
    .string()
    .describe(
      'Raw WWW-Authenticate header value; may include multiple payment challenges',
    ),
});
