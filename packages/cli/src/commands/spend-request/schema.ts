import { z } from 'zod';
import type { InputSchema, OutputSchema } from '../../utils/json-options';
import {
  LineItemSchema,
  TotalSchema,
  parseKvString,
} from '../../utils/line-item-parser';

export const SPEND_REQUEST_OUTPUT_SCHEMA: OutputSchema = {
  id: { outputExample: '"..."', description: 'Spend request ID' },
  status: {
    outputExample:
      '"created|pending_approval|approved|denied|expired|succeeded|failed"',
    description: 'Current status',
  },
  created_at: {
    outputExample: '"2026-04-15T14:17:18Z"',
    description: 'Creation timestamp',
  },
  updated_at: {
    outputExample: '"2026-04-15T14:17:18Z"',
    description: 'Last update timestamp',
  },
  payment_details: {
    outputExample: '"csmrpd_abcde12345"',
    description: 'Payment method ID',
  },
  amount: { outputExample: '1000', description: 'Amount in cents' },
  merchant_name: { outputExample: '"Powdur"', description: 'Merchant name' },
  line_items: { outputExample: '[...]', description: 'Line items' },
  totals: { outputExample: '[...]', description: 'Totals' },
  card: {
    outputExample:
      '{"number":"4242424242424242","exp_month":12,"exp_year":2027,"cvc":"123","billing_address":{"name":"Jane Doe","line1":"123 Main St","city":"San Francisco","state":"CA","postal_code":"94111","country":"US"},"valid_until":1750000000}',
    description:
      'Card credentials (present when credential_type is card and status is approved). Includes billing_address (name, line1, line2, city, state, postal_code, country) and valid_until (unix timestamp) when available.',
  },
  shared_payment_token: {
    outputExample:
      '{"id":"spt_xxx","billing_address":{"name":"Jane Doe","line1":"123 Main St","city":"San Francisco","state":"CA","postal_code":"94111","country":"US"},"valid_until":"2026-04-21T20:46:58Z"}',
    description:
      'Shared payment token object (present when credential_type is shared_payment_token and status is approved). Use the "id" field as the SPT value.',
  },
};

export const CREATE_INPUT_SCHEMA: InputSchema = {
  payment_method_id: {
    schema: z.string().min(1),
    flag: '--payment-method-id <id>',
    description: 'Payment method ID',
    required: true,
  },
  credential_type: {
    schema: z.enum(['shared_payment_token', 'card']),
    flag: '--credential-type <type>',
    description: 'Payment credential type',
    jsonDescription:
      '"card" for checkout forms/Stripe Elements; "shared_payment_token" for HTTP 402/machine payment flows — evaluate the merchant site before choosing',
    defaultValue: 'card',
    required: true,
  },
  network_id: {
    schema: z.string().min(1),
    flag: '--network-id <id>',
    description: 'Network ID (required for shared_payment_token)',
    jsonDescription:
      'Required for shared_payment_token — use `link-cli mpp decode --challenge <www-authenticate>` to validate the stripe challenge and extract this value',
  },
  amount: {
    schema: z.coerce.number().int().positive().max(50000),
    flag: '--amount <cents>',
    description: 'Amount in cents',
    jsonDescription: 'Total in cents, max 50000 ($500.00)',
    required: true,
  },
  currency: {
    schema: z.string().length(3),
    flag: '--currency <code>',
    description: 'Currency code',
    defaultValue: 'usd',
  },
  merchant_name: {
    schema: z.string().min(3),
    flag: '--merchant-name <name>',
    description: 'Merchant name',
    jsonDescription:
      'Required for card credential type; forbidden for shared_payment_token',
    alias: '-m',
  },
  merchant_url: {
    schema: z.url(),
    flag: '--merchant-url <url>',
    description: 'Merchant URL',
    jsonDescription:
      'Required for card credential type; forbidden for shared_payment_token',
  },
  context: {
    schema: z.string().min(100),
    flag: '--context <context>',
    description: 'Description of what is being purchased and why',
    jsonDescription:
      'Min 100 chars — write a full sentence describing the purchase and rationale; the user reads this when approving',
    required: true,
  },
  line_items: {
    schema: z.array(LineItemSchema),
    flag: '--line-item <item>',
    description: 'Line item (repeatable)',
    flagParser: parseKvString,
  },
  totals: {
    schema: z.array(TotalSchema),
    flag: '--total <total>',
    description: 'Total (repeatable)',
    flagParser: parseKvString,
  },
  request_approval: {
    schema: z.boolean(),
    flag: '--request-approval',
    description: 'Request approval and wait for user to approve/deny',
    jsonDescription:
      'Polls until approved/denied/expired; blocks until the user acts',
    defaultValue: true,
  },
  test: {
    schema: z.boolean(),
    flag: '--test',
    description:
      'Use test mode (creates testmode credentials from test card data)',
    jsonDescription:
      'When true, creates testmode credentials instead of real ones — safe for development and testing',
    defaultValue: false,
  },
};

export const RETRIEVE_INPUT_SCHEMA: InputSchema = {
  timeout: {
    schema: z.coerce.number(),
    flag: '--timeout <seconds>',
    description: 'Polling timeout in seconds',
    defaultValue: 300,
  },
  include: {
    schema: z.array(z.string()),
    flag: '--include <value>',
    description: 'Include extra data (repeatable, e.g. --include card)',
  },
};

export const UPDATE_INPUT_SCHEMA: InputSchema = {
  payment_method_id: {
    schema: z.string().min(1),
    flag: '--payment-method-id <id>',
    description: 'Payment method ID',
    required: true,
  },
  amount: {
    schema: z.coerce.number().int().positive(),
    flag: '--amount <cents>',
    description: 'Amount in cents',
  },
  merchant_url: {
    schema: z.string().min(1),
    flag: '--merchant-url <url>',
    description: 'Merchant URL',
  },
  profile_id: {
    schema: z.string().min(1),
    flag: '--profile-id <id>',
    description: 'Profile ID',
  },
  merchant_id: {
    schema: z.string().min(1),
    flag: '--merchant-id <id>',
    description: 'Merchant ID',
  },
  currency: {
    schema: z.string().min(1),
    flag: '--currency <code>',
    description: 'Currency code',
  },
  line_items: {
    schema: z.array(LineItemSchema),
    flag: '--line-item <item>',
    description: 'Line item (repeatable)',
    flagParser: parseKvString,
  },
  totals: {
    schema: z.array(TotalSchema),
    flag: '--total <total>',
    description: 'Total (repeatable)',
    flagParser: parseKvString,
  },
};
