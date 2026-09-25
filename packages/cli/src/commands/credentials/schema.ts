import { z } from 'incur';

export const presentOptions = z.object({
  aud: z.string().min(1).describe('Exact audience from the verifier challenge'),
  nonce: z.string().min(1).describe('Nonce from the verifier challenge'),
  claim: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      'Top-level claim to disclose (required, repeatable, e.g. --claim email)',
    ),
});
