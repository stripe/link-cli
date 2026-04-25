import { z } from 'incur';

export const payOptions = z.object({
  spendRequestId: z
    .string()
    .describe(
      'Approved spend request ID with credential_type "shared_payment_token"',
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
});

export const decodeOptions = z.object({
  challenge: z
    .string()
    .describe(
      'Raw WWW-Authenticate header value; may include multiple payment challenges',
    ),
});
