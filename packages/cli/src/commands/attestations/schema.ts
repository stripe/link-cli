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

export const savedAttestationSchema = z
  .object({
    version: z.literal(1),
    issuer: z.url(),
    token_key_id: z.string().min(1),
    count: z.number().int().min(0).max(100),
    tokens: z
      .array(
        z.object({
          token: z.string().min(1),
          authorization: z.string().min(1),
        }),
      )
      .max(100),
  })
  .refine((artifact) => artifact.count === artifact.tokens.length);
