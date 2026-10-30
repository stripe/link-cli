import { z } from 'incur';
import { SOURCE_ACTIONS } from '../../auth/types';

const SOURCE_ACTIONS_DESCRIPTION = SOURCE_ACTIONS.join(', ');

const accessOptions = z.object({
  clientName: z
    .string()
    .default('Link CLI')
    .describe(
      'Agent or app name shown in the Link app when approving the device connection',
    ),
  scope: z
    .string()
    .optional()
    .describe(
      'Optional space-separated Link scopes to request. Quote the value when passing multiple scopes.',
    ),
  sourceActions: z
    .array(z.enum(SOURCE_ACTIONS))
    .default([])
    .describe(
      `Source action to request via authorization_details (repeatable). On login, explicit actions replace defaults. Accepted values: ${SOURCE_ACTIONS_DESCRIPTION}.`,
    ),
  authorizationDetail: z
    .array(z.string())
    .default([])
    .describe('Freeform authorization_details entry as raw JSON (repeatable).'),
  interval: z.coerce
    .number()
    .default(0)
    .describe(
      'Poll interval in seconds. When > 0, polls until authenticated or timeout is reached, yielding status on each attempt.',
    ),
  maxAttempts: z.coerce
    .number()
    .default(0)
    .describe('Max poll attempts. 0 = unlimited (use timeout instead).'),
  timeout: z.coerce
    .number()
    .default(300)
    .describe('Polling timeout in seconds.'),
});

export const loginOptions = accessOptions.extend({
  financialInsights: z
    .boolean()
    .optional()
    .describe(
      'Request all financial-insights source actions by default. Use --no-financial-insights to opt out.',
    ),
  agenticPayments: z
    .boolean()
    .optional()
    .describe(
      'Request the payment_methods.agentic scope by default. Use --no-agentic-payments to opt out.',
    ),
});

export const upgradeOptions = accessOptions;

export const statusOptions = z.object({
  interval: z.coerce
    .number()
    .default(0)
    .describe(
      'Poll interval in seconds. When > 0, polls until authenticated or timeout is reached, yielding status on each attempt.',
    ),
  maxAttempts: z.coerce
    .number()
    .default(0)
    .describe('Max poll attempts. 0 = unlimited (use timeout instead).'),
  timeout: z.coerce
    .number()
    .default(300)
    .describe('Polling timeout in seconds.'),
});
