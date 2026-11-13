import { z } from 'incur';

export const inspectOptions = z.object({
  timeout: z
    .number()
    .int()
    .positive()
    .max(2_147_483_647)
    .optional()
    .describe(
      'Timeout in milliseconds for the Directory API request (default: 5000)',
    ),
});
