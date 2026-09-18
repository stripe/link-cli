import { z } from 'incur';

// Inspect the saved metadata only; this is not credential verification.
export const savedCredentialSchema = z.object({
  version: z.literal(1),
  credential: z.string().min(1),
  issuer: z.url(),
  expires_at: z.iso.datetime({ offset: true }),
  holder: z.object({
    path: z.string().min(1),
    thumbprint: z.string().min(1),
  }),
  claims: z.record(z.string(), z.unknown()).optional(),
});
