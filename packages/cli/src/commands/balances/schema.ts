import { z } from 'incur';

export const listOptions = z.object({
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
