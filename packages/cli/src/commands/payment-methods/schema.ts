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
    .optional()
    .describe('New nickname; pass an empty string to clear the nickname'),
  isDefault: z
    .enum(['true', 'false'])
    .optional()
    .describe(
      'Set this payment method as the wallet default (true) or clear its default status (false)',
    ),
});
