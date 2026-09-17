import { z } from 'incur';

export const retrieveArgs = z.object({
  id: z.string().describe('Payment method ID'),
});
