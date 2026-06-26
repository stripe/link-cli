import { z } from 'incur';

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const listOptions = z.object({
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe('Maximum number of transactions to return (1-100).'),
  startingAfter: z
    .string()
    .optional()
    .describe('Cursor: return transactions after this transaction ID.'),
  endingBefore: z
    .string()
    .optional()
    .describe('Cursor: return transactions before this transaction ID.'),
  startDate: z
    .string()
    .regex(ISO_DATE_REGEX, 'Date must be in YYYY-MM-DD format.')
    .optional()
    .describe('Only include transactions on or after this YYYY-MM-DD date.'),
  endDate: z
    .string()
    .regex(ISO_DATE_REGEX, 'Date must be in YYYY-MM-DD format.')
    .optional()
    .describe('Only include transactions on or before this YYYY-MM-DD date.'),
  category: z.string().optional().describe('Filter by transaction category.'),
});
