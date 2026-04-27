import { z } from 'incur';

export const loginOptions = z.object({
  clientName: z
    .string()
    .default('Link CLI')
    .describe(
      'Agent or app name shown in the Link app when approving the device connection',
    ),
});

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
