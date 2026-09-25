import { z } from 'zod';
import { REPORT_OUTCOMES, REPORT_TAGS } from '../resources/interfaces';

const id = z.string().min(1);
const money = z.number().int();
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
const pagination = {
  limit: z.number().int().min(1).max(100).optional(),
  starting_after: id.optional(),
  ending_before: id.optional(),
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
    .strictObject({
      idempotency_key: id
        .refine(
          (key) => new TextEncoder().encode(key).length <= 255,
          'At most 255 UTF-8 bytes',
        )
        .optional()
        .describe('Reuse only when retrying the same logical creation.'),
      payment_details: id
        .optional()
        .describe('Payment method ID; omit to use the default.'),
      credential_type: z.enum(['card', 'shared_payment_token']).default('card'),
      network_id: id.optional().describe('Required for shared payment tokens.'),
      execution_method: z.literal('link_pay_token').optional(),
      merchant_account_id: id
        .optional()
        .describe(
          'For link_pay_token, read data-stripe-merchant-account from the checkout DOM.',
        ),
      amount: money.positive().max(500000).describe('Amount in cents.'),
      currency: z.string().length(3).default('usd'),
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
    })
    .superRefine((value, ctx) => {
      if (value.execution_method === 'link_pay_token') {
        if (
          !value.merchant_account_id ||
          value.credential_type !== 'card' ||
          value.test ||
          value.network_id ||
          value.merchant_name ||
          value.merchant_url
        ) {
          ctx.addIssue({
            code: 'custom',
            message:
              'link_pay_token requires merchant_account_id and card credentials; omit merchant_name, merchant_url, network_id, and test mode.',
          });
        }
      } else if (value.merchant_account_id) {
        ctx.addIssue({
          code: 'custom',
          path: ['merchant_account_id'],
          message: 'Requires execution_method: link_pay_token.',
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
