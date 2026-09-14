import { z } from 'incur';

export const payOptions = z.object({
  spendRequestId: z
    .string()
    .optional()
    .describe(
      'Approved Link spend request ID with credential_type "shared_payment_token" or "signed_transaction". Omit to probe the endpoint and create the appropriate request.',
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
      'Min 100 chars — describe the purchase and rationale shown during Link approval. Required when --spend-request-id is omitted.',
    ),
  amount: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Stripe only: amount in cents (derived from the challenge if omitted). Tempo always signs the exact challenged amount.',
    ),
  paymentMethodId: z
    .string()
    .optional()
    .describe('Stripe only: Link payment method ID (uses default if omitted)'),
  test: z
    .boolean()
    .default(false)
    .describe('Stripe only: create testmode credentials from test card data.'),
});

export const decodeOptions = z.object({
  challenge: z
    .string()
    .describe(
      'Raw WWW-Authenticate header value; may include multiple payment challenges',
    ),
});
