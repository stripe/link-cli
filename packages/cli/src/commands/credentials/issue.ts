import {
  type HolderPublicJwk,
  holderJwksEqual,
  holderJwkThumbprint,
  type IIdentityCredentialsResource,
  parseHolderPublicJwk,
} from '@stripe/link-sdk';
import { sanitizeDeep } from '../../utils/sanitize-text';
import { DEFAULT_HOLDER_KEY_PATH, loadOrCreateHolderKey } from './holder-key';

export const IDENTITY_CREDENTIAL_ARTIFACT_VERSION = 1 as const;

export interface IdentityCredentialHolder {
  jwk: HolderPublicJwk;
  thumbprint: string;
  path: string;
  created: boolean;
}

export interface IdentityCredentialIssueResult {
  version: typeof IDENTITY_CREDENTIAL_ARTIFACT_VERSION;
  credential: string;
  issuer: string;
  expires_at: string;
  holder: IdentityCredentialHolder;
  /** Claim names and values recovered from disclosures. Inspection only. */
  claims?: Record<string, unknown>;
}

function decodeJsonSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeDisclosedClaims(credential: string): Record<string, unknown> {
  const [, ...disclosures] = credential.split('~');
  const claims: Record<string, unknown> = {};

  for (const disclosure of disclosures) {
    if (!disclosure) {
      continue;
    }
    const parsed = decodeJsonSegment(disclosure);
    if (Array.isArray(parsed) && parsed.length === 3) {
      claims[String(parsed[1])] = parsed[2];
    }
  }

  return claims;
}

function credentialHolderJwk(credential: string): HolderPublicJwk {
  const [issuerJwt] = credential.split('~');
  const payloadSegment = issuerJwt?.split('.')[1];
  if (!payloadSegment) {
    throw new Error('Issued credential is not a compact SD-JWT');
  }
  const payload = decodeJsonSegment(payloadSegment);
  if (!isRecord(payload) || !isRecord(payload.cnf)) {
    throw new Error('Issued credential is missing cnf.jwk');
  }
  return parseHolderPublicJwk(payload.cnf.jwk);
}

export async function issueIdentityCredential(options: {
  resource: IIdentityCredentialsResource;
  keyFile?: string;
  includeClaims?: boolean;
}): Promise<IdentityCredentialIssueResult> {
  const {
    resource,
    keyFile = DEFAULT_HOLDER_KEY_PATH,
    includeClaims = true,
  } = options;
  const holderKey = loadOrCreateHolderKey(keyFile);
  const publicJwk = holderKey.publicJwk;

  const response = await resource.issue({
    cnf: { jwk: publicJwk },
  });
  const issuedJwk = credentialHolderJwk(response.credential);
  if (!holderJwksEqual(issuedJwk, publicJwk)) {
    throw new Error(
      'Issued credential cnf.jwk does not match the requested holder public key',
    );
  }

  return {
    version: IDENTITY_CREDENTIAL_ARTIFACT_VERSION,
    credential: response.credential,
    issuer: response.issuer,
    expires_at: response.expires_at,
    holder: {
      jwk: publicJwk,
      thumbprint: holderJwkThumbprint(publicJwk),
      path: keyFile,
      created: holderKey.created,
    },
    ...(includeClaims
      ? { claims: sanitizeDeep(decodeDisclosedClaims(response.credential)) }
      : {}),
  };
}
