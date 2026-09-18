import { z } from 'incur';

export const requestOptions = z.object({
  count: z.coerce
    .number()
    .int()
    .positive()
    .max(100)
    .describe('Number of tokens to request'),
  outputFile: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Export a batch to a new file for agent-managed use instead of adding it to the CLI pool',
    ),
});
