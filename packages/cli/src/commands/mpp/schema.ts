import { z } from 'zod';
import type { InputSchema, OutputSchema } from '../../utils/json-options';

export const DECODE_OUTPUT_SCHEMA: OutputSchema = {
  id: { outputExample: '"ch_123"', description: 'Challenge ID' },
  realm: {
    outputExample: '"merchant.example"',
    description: 'Challenge realm',
  },
  method: { outputExample: '"stripe"', description: 'Payment method' },
  intent: { outputExample: '"charge"', description: 'Challenge intent' },
  network_id: {
    outputExample: '"net_prod_123"',
    description: 'Extracted Stripe network ID',
  },
  request_json: {
    outputExample:
      '{"networkId":"net_prod_123","amount":"1000","currency":"usd","decimals":2,"paymentMethodTypes":["card"]}',
    description:
      'Decoded request payload from the stripe challenge before normalization',
  },
};

export const PAY_INPUT_SCHEMA: InputSchema = {
  spend_request_id: {
    schema: z.string().min(1),
    flag: '--spend-request-id <id>',
    description:
      'Approved spend request ID with shared_payment_token credential',
    jsonDescription:
      'Must be an approved spend request with credential_type "shared_payment_token" — the SPT is one-time use; create a new request if payment fails',
    required: true,
  },
  method: {
    schema: z.string().min(1),
    flag: '--method <method>',
    alias: '-X',
    description: 'HTTP method (default: GET, or POST if --data is provided)',
  },
  data: {
    schema: z.string().min(1),
    flag: '--data <body>',
    alias: '-d',
    description: 'Request body (implies POST if --method is not set)',
  },
  headers: {
    schema: z.array(z.string().min(1)),
    flag: '--header <header>',
    alias: '-H',
    description: 'Request header in "Name: Value" format (repeatable)',
    jsonDescription:
      'Repeatable; "Name: Value" format — Content-Type is auto-set when --data is provided; user headers take precedence',
  },
};

export const DECODE_INPUT_SCHEMA: InputSchema = {
  challenge: {
    schema: z.string().min(1),
    flag: '--challenge <header>',
    description: 'Raw WWW-Authenticate header value to decode',
    jsonDescription:
      'Raw WWW-Authenticate header value; may include multiple payment challenges',
    required: true,
  },
};

export const PAY_OUTPUT_SCHEMA: OutputSchema = {
  status: { outputExample: '200', description: 'HTTP response status code' },
  headers: {
    outputExample: '{"content-type":"application/json"}',
    description: 'Response headers',
  },
  body: { outputExample: '"..."', description: 'Response body' },
};
