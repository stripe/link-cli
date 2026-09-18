import { z } from 'incur';

export const ATTESTATION_ARTIFACT_VERSION = 1 as const;

export function base64urlPad(value: Uint8Array | string): string {
  const unpadded =
    typeof value === 'string'
      ? value.replace(/=+$/, '')
      : Buffer.from(value).toString('base64url');
  const pad = (4 - (unpadded.length % 4)) % 4;
  return `${unpadded}${'='.repeat(pad)}`;
}

/**
 * Exact Authorization header for a bearer AAT. Token bytes are preserved;
 * only base64url padding is added for the header parameter.
 */
export function authorizationHeader(token: string): string {
  return `PrivateToken token="${base64urlPad(token)}"`;
}

export interface ExportedAttestationToken {
  token: string;
  authorization: string;
}

export interface AttestationExport {
  version: typeof ATTESTATION_ARTIFACT_VERSION;
  issuer: string;
  token_key_id: string;
  count: number;
  tokens: ExportedAttestationToken[];
}

export function exportAttestationTokens(result: {
  tokens: string[];
  issuer: string;
  token_key_id: string;
  count: number;
}): AttestationExport {
  return {
    version: ATTESTATION_ARTIFACT_VERSION,
    issuer: result.issuer,
    token_key_id: result.token_key_id,
    count: result.count,
    tokens: result.tokens.map((token) => ({
      token,
      authorization: authorizationHeader(token),
    })),
  };
}

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
