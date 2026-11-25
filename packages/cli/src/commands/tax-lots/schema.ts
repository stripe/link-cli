import { z } from 'incur';

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const listOptions = z
  .object({
    holding: z
      .string()
      .min(1)
      .describe('Holding ID whose cached acquisition lots to list (required).'),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Maximum tax lots per page (1-100; API default 10).'),
    startingAfter: z
      .string()
      .optional()
      .describe(
        'Cursor: tax lots after this lot ID; cannot combine with ending-before.',
      ),
    endingBefore: z
      .string()
      .optional()
      .describe(
        'Cursor: tax lots before this lot ID; cannot combine with starting-after.',
      ),
    startDate: z
      .string()
      .regex(ISO_DATE_REGEX, 'Date must be in YYYY-MM-DD format.')
      .optional()
      .describe('Include lots purchased on or after this YYYY-MM-DD date.'),
    endDate: z
      .string()
      .regex(ISO_DATE_REGEX, 'Date must be in YYYY-MM-DD format.')
      .optional()
      .describe('Include lots purchased on or before this YYYY-MM-DD date.'),
  })
  .refine(
    (options) =>
      options.startingAfter === undefined || options.endingBefore === undefined,
    { message: 'Use only one of starting-after or ending-before.' },
  );
