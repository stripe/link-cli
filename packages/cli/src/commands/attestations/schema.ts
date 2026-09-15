import { z } from 'incur';

export const requestOptions = z.object({
  count: z.coerce
    .number()
    .int()
    .positive()
    .max(100)
    .describe('Number of tokens to request'),
});
