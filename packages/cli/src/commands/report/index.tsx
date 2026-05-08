import type { AuthStorage, IReportResource } from '@stripe/link-sdk';
import { Cli, z } from 'incur';
import { requireAuth } from '../../utils/require-auth';

const VALID_OUTCOMES = ['success', 'blocked', 'abandoned'] as const;
const VALID_TAGS = [
  'stripe_checkout',
  'captcha',
  'anti_bot_script',
  'cdn_block',
  'waf_block',
  'dns_block',
  'rate_limited',
  'login_required',
  '3ds_challenge',
  'page_inaccessible',
  'timeout',
  'site_error',
  'payment_declined',
  'other',
] as const;

const reportOptions = z.object({
  domain: z.string().describe('Domain where the outcome occurred'),
  outcome: z
    .enum(VALID_OUTCOMES)
    .describe('What happened: success, blocked, or abandoned'),
  spendRequestId: z.string().describe('Spend request ID (lsrq_...)'),
  tag: z
    .array(z.enum(VALID_TAGS))
    .optional()
    .describe('Outcome tags (repeatable)'),
  step: z.string().optional().describe('Where in the flow the agent was'),
  freeformContext: z
    .string()
    .optional()
    .describe('Additional context (max 500 chars)'),
});

export function createReportCli(
  reports: IReportResource,
  authStorage?: AuthStorage,
) {
  const cli = Cli.create('report', {
    description: 'Report the outcome of a purchase attempt',
  });

  cli.command('', {
    description:
      'Report the outcome of an agent action on a domain. Call after every purchase attempt.',
    options: reportOptions,
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage)],
    async run(c) {
      const result = await reports.create({
        domain: c.options.domain,
        outcome: c.options.outcome,
        spend_request_id: c.options.spendRequestId,
        tags: c.options.tag,
        step: c.options.step,
        freeform_context: c.options.freeformContext,
      });
      return result;
    },
  });

  return cli;
}
