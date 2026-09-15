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
