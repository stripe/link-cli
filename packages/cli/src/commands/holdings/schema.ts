import { z } from 'incur';

export const listOptions = z
  .object({
    source: z
      .string()
      .min(1)
      .describe('Link source ID whose cached holdings to list (required).'),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Maximum holdings per page (1-100).'),
    startingAfter: z
      .string()
      .optional()
      .describe(
        'Cursor: holdings after this holding ID; cannot combine with ending-before.',
      ),
    endingBefore: z
      .string()
      .optional()
      .describe(
        'Cursor: holdings before this holding ID; cannot combine with starting-after.',
      ),
  })
  .refine(
    (options) =>
      options.startingAfter === undefined || options.endingBefore === undefined,
    {
      message: 'Use only one of starting-after or ending-before.',
    },
  );
