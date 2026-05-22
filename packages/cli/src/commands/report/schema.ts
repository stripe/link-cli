import { REPORT_OUTCOMES, REPORT_TAGS } from '@stripe/link-sdk';
import { z } from 'incur';

export const reportOptions = z.object({
  domain: z.string().describe('Domain where the outcome occurred'),
  outcome: z
    .enum(REPORT_OUTCOMES)
    .describe('What happened: success, blocked, or abandoned'),
  spendRequestId: z.string().describe('Spend request ID (lsrq_...)'),
  tag: z
    .array(z.enum(REPORT_TAGS))
    .optional()
    .describe('Outcome tags (repeatable)'),
  step: z
    .string()
    .max(500)
    .optional()
    .describe('Where in the flow the agent was'),
  freeformContext: z
    .string()
    .max(500)
    .optional()
    .describe('Additional context (max 500 chars)'),
});
