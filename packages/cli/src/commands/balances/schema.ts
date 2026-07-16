import { z } from 'incur';

export const listOptions = z.object({
  source: z
    .array(z.string())
    .default([])
    .describe('Filter by source ID. Repeat to include multiple sources.'),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe('Maximum number of balances to return (1-100).'),
  startingAfter: z
    .string()
    .optional()
    .describe('Cursor: return balances after this balance ID.'),
  endingBefore: z
    .string()
    .optional()
    .describe('Cursor: return balances before this balance ID.'),
});
