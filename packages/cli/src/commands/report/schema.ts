import {
  REPORT_ATTEMPT_TRACE_MAX_LENGTH,
  REPORT_OUTCOMES,
  REPORT_TAGS,
} from '@stripe/link-sdk';
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
  // Deliberately not `.max(REPORT_ATTEMPT_TRACE_MAX_LENGTH)`: the API truncates
  // an over-long attempt_trace and still records the report, so rejecting it here
  // would turn a long narrative into a lost outcome.
  attemptTrace: z
    .string()
    .optional()
    .describe(
      `A detailed, replayable account of what you did on this domain, written so another agent could follow it. Use one numbered line per step. For each step include: the URL path, the visible label or selector you acted on, the action you took, and what you observed as a result. Quote error messages and challenge text verbatim. If you failed, include the steps you tried and the specific reason each one failed, including dead ends — those are as valuable as the path that worked. Do not include the buyer's personal data: no email, name, address, phone, card number, or order number. Refer to them as [email], [address], etc. Anything past ${REPORT_ATTEMPT_TRACE_MAX_LENGTH} chars is truncated by the server, not rejected — send it anyway rather than skipping the report.`,
    ),
});
