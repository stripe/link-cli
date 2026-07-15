import { z } from 'incur';

export const createOptions = z.object({
  paymentMethodId: z.string().optional().describe('Payment method ID'),
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
    .max(500000)
    .describe('Amount in cents, max 500000 ($5,000.00)'),
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
    .describe(
      'Line item (repeatable, key:value format). Keys: name (required), quantity, unit_amount, description, sku, url, image_url, product_url. Example: "name:Shoes,unit_amount:5000,quantity:2"',
    ),
  total: z
    .array(z.union([z.string(), z.record(z.string(), z.unknown())]))
    .default([])
    .describe(
      'Total (repeatable, key:value format). Keys: type (required; one of: subtotal, tax, total, items_base_amount, items_discount, discount, fulfillment, shipping, fee, gift_wrap, tip, store_credit), display_text (required), amount (required). Example: "type:total,display_text:Total,amount:5000"',
    ),
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
  approve: z.boolean().default(false).describe(''),
  outputFile: z
    .string()
    .optional()
    .describe(
      'Write full card credentials to this file path; stdout shows redacted card data only',
    ),
  force: z
    .boolean()
    .default(false)
    .describe('Overwrite output file if it already exists'),
  approvalDetail: z
    .union([z.string(), z.record(z.string(), z.unknown())])
    .optional()
    .describe(
      'Approval details object (MCP/agent: pass as object; CLI: pass as JSON string). Required fields: approved_at (unix timestamp), approval_method (click|programmatic|voice), app_name, external_user_id. Optional: ip_address, user_agent, device_type (mobile|web), agent_log_id, external_user_name, external_session_id, authentication_method (biometric_face|biometric_fingerprint|passkey).',
    ),
});

export const listOptions = z.object({
  includeHistory: z
    .boolean()
    .default(false)
    .describe('Include expired and terminal spend requests'),
});

export const retrieveOptions = z.object({
  timeout: z.coerce
    .number()
    .default(600)
    .describe(
      'Polling timeout in seconds. When reached during active polling, exits non-zero with POLLING_TIMEOUT. Default exceeds the server-side spend-request expiry so polling outlives the request itself.',
    ),
  interval: z.coerce
    .number()
    .default(0)
    .describe(
      'Poll interval in seconds. When > 0, polls until status is terminal, timeout is reached, or max attempts are exhausted.',
    ),
  maxAttempts: z.coerce
    .number()
    .default(0)
    .describe(
      'Max poll attempts. 0 = unlimited. Exhaustion during active polling exits non-zero with POLLING_TIMEOUT.',
    ),
  include: z
    .array(z.string())
    .default([])
    .describe('Include extra data (repeatable, e.g. --include card)'),
  outputFile: z
    .string()
    .optional()
    .describe(
      'Write full card credentials to this file path; stdout shows redacted card data only',
    ),
  force: z
    .boolean()
    .default(false)
    .describe('Overwrite output file if it already exists'),
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
    .describe(
      'Line item (repeatable, key:value format). Keys: name (required), quantity, unit_amount, description, sku, url, image_url, product_url. Example: "name:Shoes,unit_amount:5000,quantity:2"',
    ),
  total: z
    .array(z.union([z.string(), z.record(z.string(), z.unknown())]))
    .default([])
    .describe(
      'Total (repeatable, key:value format). Keys: type (required; one of: subtotal, tax, total, items_base_amount, items_discount, discount, fulfillment, shipping, fee, gift_wrap, tip, store_credit), display_text (required), amount (required). Example: "type:total,display_text:Total,amount:5000"',
    ),
});
