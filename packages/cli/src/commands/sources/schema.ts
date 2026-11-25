import { z } from 'incur';

export const listOptions = z.object({
  category: z
    .string()
    .optional()
    .describe(
      'Filter by source category, such as investment. The API validates category values.',
    ),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe('Maximum number of sources to return (1-100).'),
  startingAfter: z
    .string()
    .optional()
    .describe('Cursor: return sources after this source ID.'),
  endingBefore: z
    .string()
    .optional()
    .describe('Cursor: return sources before this source ID.'),
});
