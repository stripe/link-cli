import { z } from 'incur';

export const retrieveArgs = z.object({
  id: z.string().describe('Payment method ID'),
});

export const updateArgs = z.object({
  id: z.string().describe('Payment method ID'),
});

export const updateOptions = z.object({
  nickname: z
    .string()
    .describe('New nickname; pass an empty string to clear the nickname'),
});
