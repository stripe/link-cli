import { z } from 'incur';

export const requestOptions = z.object({
  count: z.coerce
    .number()
    .int()
    .positive()
    .max(100)
    .describe('Number of tokens to request'),
});

export const showOptions = z.object({
  file: z
    .string()
    .min(1)
    .describe(
      'Saved JSON file path or filename from identity attestations list. Shows metadata only; does not consume tokens.',
    ),
});
