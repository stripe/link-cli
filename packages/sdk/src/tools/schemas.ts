import { z } from 'zod';
import { REPORT_OUTCOMES, REPORT_TAGS } from '../resources/interfaces';

const id = z.string().min(1);
const money = z
  .number()
  .int()
  .describe('Amount in the currency’s minor units.');
const total = z.strictObject({
  type: z.string(),
  display_text: z.string(),
  amount: money,
});
const lineItem = z.strictObject({
  name: z.string(),
  quantity: z.number().int().positive().optional(),
  unit_amount: money.optional(),
  description: z.string().optional(),
  sku: z.string().optional(),
  url: z.string().optional(),
  image_url: z.string().optional(),
  product_url: z.string().optional(),
  totals: z.array(total).optional(),
});
// execution_method was replaced by credential_type: link_pay_token.
const removedExecutionMethodError = {
  error: (issue: z.core.$ZodRawIssue) =>
    issue.code === 'unrecognized_keys' &&
    issue.keys.includes('execution_method')
      ? 'execution_method has been removed. Use credential_type: link_pay_token with merchant_account_id.'
      : undefined,
};
const pagination = {
  limit: z.number().int().min(1).max(100).optional(),
  starting_after: id.optional(),
  ending_before: id.optional(),
};

const mppRequest = {
  url: z.url().describe('URL to probe for a Machine Payment Protocol 402.'),
  method: z
    .string()
    .optional()
    .describe('HTTP method. Defaults to GET, or POST when body is set.'),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
};

const insightPagination = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Maximum results per page. Defaults to 10.'),
  starting_after: id
    .optional()
    .describe('Return results after this insight ID from the previous page.'),
};

/** API inputs, independent of CLI flags and framework execution context. */
export const linkToolSchemas = {
  empty: z.strictObject({}),
  spendRequestId: z.strictObject({ id: id.describe('Link spend request ID') }),
  listSpendRequests: z.strictObject({
    include_history: z
      .boolean()
      .optional()
      .describe('Include expired and terminal requests'),
  }),
  retrieveSpendRequest: z.strictObject({
    id: id.describe('Link spend request ID'),
    include: z
      .array(z.string())
      .optional()
      .describe(
        'Extra data to return, such as card credentials. Request only when needed for checkout.',
      ),
  }),
  createSpendRequest: z
    .strictObject(
      {
        idempotency_key: id
          .refine(
            (key) => new TextEncoder().encode(key).length <= 255,
            'At most 255 UTF-8 bytes',
          )
          .optional()
          .describe('Reuse only when retrying the same logical creation.'),
        completion_callback_url: z
          .url()
          .max(2048)
          .optional()
          .describe(
            'Callback destination (max 2,048 characters) included in returned approval and supported action URLs. Supply together with nonce. The API validates live-mode HTTPS and URL security.',
          ),
        nonce: z
          .string()
          .max(512)
          .refine(
            (value) => value.length <= 512,
            'Nonce must be at most 512 UTF-16 code units',
          )
          .refine((value) => value.trim().length > 0, 'Must not be blank')
          .optional()
          .describe(
            'Opaque callback nonce (max 512 UTF-16 code units). Supply together with completion_callback_url, save unchanged, and verify an exact match when the callback is received.',
          ),
        payment_details: id
          .optional()
          .describe('Payment method ID; omit to use the default.'),
        credential_type: z
          .enum(['card', 'shared_payment_token', 'link_pay_token'])
          .default('card')
          .describe(
            'Use link_pay_token for supported Stripe payment surfaces.',
          ),
        network_id: id
          .optional()
          .describe('Required for shared payment tokens.'),
        merchant_account_id: id
          .optional()
          .describe(
            'For link_pay_token, read data-stripe-merchant-account from the checkout DOM.',
          ),
        amount: money
          .positive()
          .max(500000)
          .describe(
            'Amount in the currency’s minor units. For recurring requests, including shared payment tokens, the spending limit per period. The available spending amount resets to this limit each new period.',
          ),
        currency: z
          .string()
          .length(3)
          .optional()
          .describe(
            'Currency code. Omit to use the consumer’s default spend-request currency. Specify explicitly when the amount comes from a checkout with a known currency.',
          ),
        merchant_name: z.string().min(1).optional(),
        merchant_url: z.url().optional(),
        context: z
          .string()
          .min(100)
          .describe(
            'Describe the purchase and rationale. The user reads this when approving.',
          ),
        line_items: z.array(lineItem).optional(),
        totals: z.array(total).optional(),
        request_approval: z
          .boolean()
          .default(true)
          .describe(
            'Ask Link for user approval; return the approval URL without polling.',
          ),
        test: z
          .boolean()
          .default(false)
          .describe('Create test credentials instead of live credentials.'),
        metadata: z
          .record(z.string().max(40), z.string().max(500))
          .refine(
            (value) => Object.keys(value).length <= 50,
            'At most 50 metadata entries',
          )
          .optional(),
        recurring: z
          .strictObject({
            interval: z.enum(['day', 'week', 'month', 'year']),
            interval_count: z
              .number()
              .int()
              .positive()
              .optional()
              .describe('Number of intervals per period. Defaults to 1.'),
          })
          .optional()
          .describe(
            'Recurring spending terms approved by the user. Omit for a one-time purchase.',
          ),
      },
      removedExecutionMethodError,
    )
    .superRefine((value, ctx) => {
      const hasCallback = value.completion_callback_url !== undefined;
      const hasNonce = value.nonce !== undefined;
      if (hasCallback !== hasNonce) {
        ctx.addIssue({
          code: 'custom',
          message:
            'completion_callback_url and nonce must be supplied together.',
        });
      }
      if (value.credential_type === 'link_pay_token') {
        if (
          !value.merchant_account_id ||
          value.test ||
          value.network_id ||
          value.merchant_name ||
          value.merchant_url
        ) {
          ctx.addIssue({
            code: 'custom',
            message:
              'Link Pay Token requires merchant_account_id; omit merchant_name, merchant_url, network_id, and test mode.',
          });
        }
      } else if (value.merchant_account_id) {
        ctx.addIssue({
          code: 'custom',
          path: ['merchant_account_id'],
          message: 'Requires credential_type: link_pay_token.',
        });
      } else if (value.credential_type === 'shared_payment_token') {
        if (!value.network_id)
          ctx.addIssue({
            code: 'custom',
            path: ['network_id'],
            message: 'Required for shared payment tokens.',
          });
      } else if (!value.merchant_name || !value.merchant_url) {
        ctx.addIssue({
          code: 'custom',
          message: 'Card requests require merchant_name and merchant_url.',
        });
      }
    }),
  updateSpendRequest: z.strictObject({
    id,
    payment_details: id.optional(),
    amount: money.positive().max(500000).optional(),
    currency: z.string().length(3).optional(),
    merchant_url: z.url().optional(),
    profile_id: id.optional(),
    merchant_id: id.optional(),
    line_items: z.array(lineItem).optional(),
    totals: z.array(total).optional(),
  }),
  listTransactions: z.strictObject({
    ...pagination,
    start_date: z.iso.date().optional(),
    end_date: z.iso.date().optional(),
    category: z.string().optional(),
    origin: z.enum(['link', 'external_connection']).optional(),
    sources: z.array(id).optional(),
  }),
  listSources: z.strictObject(pagination),
  listBalances: z.strictObject({
    ...pagination,
    sources: z.array(id).optional(),
  }),
  listAvailableInsightTypes: z.strictObject(insightPagination),
  listInsights: z.strictObject({
    insights: z
      .array(id)
      .optional()
      .describe(
        'Insight IDs to return. Omit to return all; request only the IDs the task needs.',
      ),
    ...insightPagination,
  }),
  mppDecode: z.strictObject(mppRequest),
  mppPay: z.strictObject({
    ...mppRequest,
    spend_request_id: id.describe(
      'Approved Link spend request ID with credential_type shared_payment_token.',
    ),
  }),
  createReport: z.strictObject({
    domain: z.string().min(1),
    outcome: z.enum(REPORT_OUTCOMES),
    spend_request_id: id,
    tags: z.array(z.enum(REPORT_TAGS)).optional(),
    step: z.string().max(500).optional(),
    freeform_context: z.string().max(500).optional(),
    attempt_trace: z
      .string()
      .optional()
      .describe(
        'Ordered account of the attempt. The API truncates long traces.',
      ),
  }),
};
