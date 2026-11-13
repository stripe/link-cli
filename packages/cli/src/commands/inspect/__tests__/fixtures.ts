export const ENTRY = {
  id: 'diren_example',
  object: 'directory.inspect_result',
  display_name: 'Example Merchant',
  url: 'example.com',
  description: 'A merchant with documented agent integrations.',
  documentation: ['https://example.com/docs'],
  context: 'Use the documented API to create an account.',
  agent_integration_actions: [
    {
      type: 'api',
      description: 'Create an account',
      url: 'https://example.com/api',
    },
  ],
  suggested_payment_mechanisms: {
    card: {
      agent_tools: {
        example: {
          setup: 'Install the merchant CLI',
          agent_prompt: 'Pay the invoice',
          supported_currencies: ['usd'],
        },
      },
    },
  },
  extra_field: { enabled: false, count: 0, unknown: null, items: [] },
};
