import { z } from 'incur';

export const inspectOptions = z.object({
  timeout: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Timeout in milliseconds for each probe request (default: 5000)'),
});
