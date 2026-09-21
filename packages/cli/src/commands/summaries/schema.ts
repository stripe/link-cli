import { z } from 'incur';

export const listOptions = z.object({
  summary: z
    .array(z.string())
    .default([])
    .describe(
      'Filter by summary ID. Repeat to include multiple summaries. Omit to include all available sumaries.',
    ),
});
