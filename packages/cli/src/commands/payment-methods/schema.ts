import type { OutputSchema } from '../../utils/json-options';

export const PAYMENT_METHOD_SCHEMA: OutputSchema = {
  id: { outputExample: '"..."', description: 'Payment method ID' },
  type: {
    outputExample: '"card|bank_account"',
    description: 'Payment method type',
  },
  is_default: {
    outputExample: 'boolean',
    description: 'Whether this is the default payment method',
  },
  nickname: {
    outputExample: '"..."',
    description: 'Optional nickname for the payment method',
  },
  card_details: {
    outputExample: '{ brand, last4, exp_month, exp_year }',
    description: 'Present when type is card',
  },
  bank_account_details: {
    outputExample: '{ last4, bank_name }',
    description: 'Present when type is bank_account',
  },
};
