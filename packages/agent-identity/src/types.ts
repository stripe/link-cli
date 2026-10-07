/** Failure codes shared by attestation and identity credential verification. */
export type FailureCode =
  /** A required credential was not supplied. */
  | 'incomplete_protocol_request'
  /** Something was present but unparseable. */
  | 'malformed_protocol_input'
  /** The Privacy Pass token's blind-RSA authenticator did not verify. */
  | 'invalid_private_token'
  /** The token does not match the stable bearer challenge. */
  | 'challenge_mismatch'
  /** The token key does not resolve to a trusted issuer key. */
  | 'unknown_issuer'
  /** The claims presentation failed a check. */
  | 'invalid_claims_presentation'
  /** Link's directory or credential JWKS could not be reached or read. */
  | 'issuer_unavailable';

export interface Failure {
  code: FailureCode;
  /** Human-readable detail. Never contains credential material. */
  message: string;
}

export interface AttestationSuccess {
  valid: true;
  /** The issuer whose key signed the token. */
  issuer: string;
  /** base64url of the full 32-byte token_key_id. */
  tokenKeyId: string;
  /** Only bearer AATs are supported; no presenter or request binding is checked. */
  bindingMode: 'bearer';
}

export interface AttestationFailure {
  valid: false;
  failures: Failure[];
}

export type AttestationResult = AttestationSuccess | AttestationFailure;

export interface ClaimsSuccess {
  valid: true;
  /** Issuer of the credential (iss of the issuer-signed JWT). */
  issuer: string;
  /** Credential type (vct). */
  vct: string;
  /** The claims actually disclosed, by name. */
  claims: Record<string, unknown>;
  /** RFC 7638 thumbprint of the credential's cnf.jwk holder key. */
  holderKeyThumbprint: string;
}

export interface ClaimsFailure {
  valid: false;
  failures: Failure[];
}

export type ClaimsResult = ClaimsSuccess | ClaimsFailure;
