/**
 * The Agent Attestation Token: challenge construction, wire parsing, and the
 * credential verification primitives.
 */
import {
  concat,
  fromBase64,
  timingSafeEqual,
  toBase64url,
  uint16be,
  utf8,
} from './internal/bytes.js';
import { sha256, verifyRsaPss } from './internal/crypto.js';
import { type ResolvedTokenKey, TOKEN_TYPE_BLIND_RSA } from './issuer.js';

const MAX_AUTHORIZATION_LENGTH = 8 * 1024;
const NONCE_SIZE = 32;
const DIGEST_SIZE = 32;
const KEY_ID_SIZE = 32;
/** Nk for a 2048-bit RSA key. */
const AUTHENTICATOR_SIZE = 256;
export const TOKEN_SIZE =
  2 + NONCE_SIZE + DIGEST_SIZE + KEY_ID_SIZE + AUTHENTICATOR_SIZE;

export interface ParsedToken {
  tokenType: number;
  nonce: Uint8Array;
  challengeDigest: Uint8Array;
  /** base64url of the 32-byte token_key_id. */
  tokenKeyId: string;
  authenticator: Uint8Array;
  /** token_type || nonce || challenge_digest || token_key_id, the signed input. */
  tokenInput: Uint8Array;
}

/**
 * Encodes a TokenChallenge (RFC 9577 §2.1):
 *
 *   struct {
 *     uint16 token_type;
 *     opaque issuer_name<1..2^16-1>;
 *     opaque redemption_context<0..32>;
 *     opaque origin_info<0..2^16-1>;
 *   } TokenChallenge;
 */
export function encodeTokenChallenge(params: {
  issuerName: string;
  /** Empty for bearer mode, or the raw 32-byte agent key thumbprint. */
  redemptionContext?: Uint8Array | undefined;
  /**
   * Always empty under this profile. Present only so the encoding is complete;
   * a non-empty value makes tokens un-poolable and will not verify against a
   * challenge this SDK issues.
   */
  originInfo?: string | undefined;
}): Uint8Array {
  const issuerBytes = utf8(params.issuerName);
  const redemption = params.redemptionContext ?? new Uint8Array(0);
  const originBytes = params.originInfo
    ? utf8(params.originInfo)
    : new Uint8Array(0);

  if (redemption.length !== 0 && redemption.length !== 32) {
    throw new Error('redemption_context must be empty or 32 bytes');
  }

  return concat(
    uint16be(TOKEN_TYPE_BLIND_RSA),
    uint16be(issuerBytes.length),
    issuerBytes,
    new Uint8Array([redemption.length]),
    redemption,
    uint16be(originBytes.length),
    originBytes,
  );
}

/**
 * Parses the redeemed token structure for type 0x0002 (RFC 9577 §2.2).
 * Returns a string describing the problem rather than throwing, because a
 * malformed token is an ordinary outcome at a front door.
 */
export function parseToken(raw: Uint8Array): ParsedToken | string {
  if (raw.length !== TOKEN_SIZE) {
    return `token is ${raw.length} bytes, expected ${TOKEN_SIZE}`;
  }
  const tokenType = ((raw[0] as number) << 8) | (raw[1] as number);
  if (tokenType !== TOKEN_TYPE_BLIND_RSA) {
    return `unsupported token_type 0x${tokenType.toString(16).padStart(4, '0')}`;
  }
  let offset = 2;
  const nonce = raw.slice(offset, offset + NONCE_SIZE);
  offset += NONCE_SIZE;
  const challengeDigest = raw.slice(offset, offset + DIGEST_SIZE);
  offset += DIGEST_SIZE;
  const keyIdBytes = raw.slice(offset, offset + KEY_ID_SIZE);
  offset += KEY_ID_SIZE;
  const authenticator = raw.slice(offset, offset + AUTHENTICATOR_SIZE);

  return {
    tokenType,
    nonce,
    challengeDigest,
    tokenKeyId: toBase64url(keyIdBytes),
    authenticator,
    tokenInput: raw.slice(0, 2 + NONCE_SIZE + DIGEST_SIZE + KEY_ID_SIZE),
  };
}

/**
 * Extracts the token from an `Authorization: PrivateToken token="..."` value.
 * Accepts the value quoted or bare, since RFC 9110 permits token68 here.
 */
export function parsePrivateTokenCredential(
  authorization: string,
): Uint8Array | string {
  if (authorization.length > MAX_AUTHORIZATION_LENGTH) {
    return 'Authorization exceeds the 8192-character limit';
  }
  if (/[\r\n]/.test(authorization)) {
    return 'Authorization contains a line break';
  }
  const field = authorization.trim();
  const scheme = /^PrivateToken[ \t]+/i.exec(field);
  if (!scheme) return 'Authorization is not a PrivateToken credential';
  const params = field.slice(scheme[0].length);

  // Auth-params are comma-separated `name=value` pairs, and RFC 9577 section 2.2.2
  // requires unknown ones to be ignored. Substring-matching `token=` instead read
  // the wrong value out of `foo-token=BBB, token=AAA`, because `foo-token` contains
  // `token`. Parsing the names is the difference.
  let value: string | undefined;
  let seen = 0;
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < params.length; i++) {
    const ch = params[i];
    if (escaped) escaped = false;
    else if (quoted && ch === '\\') escaped = true;
    else if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === ',') {
      parts.push(params.slice(start, i));
      start = i + 1;
    }
  }
  if (quoted || escaped)
    return 'PrivateToken credential has an unterminated quoted parameter';
  parts.push(params.slice(start));

  for (const part of parts) {
    const separator = part.indexOf('=');
    if (separator === -1)
      return 'PrivateToken credential has malformed auth parameters';
    const name = part.slice(0, separator).trim();
    if (!/^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/.test(name))
      return 'PrivateToken credential has malformed auth parameters';
    if (name.toLowerCase() !== 'token') continue;
    seen++;
    const rawValue = part.slice(separator + 1).trim();
    value =
      rawValue.startsWith('"') && rawValue.endsWith('"')
        ? rawValue.slice(1, -1)
        : rawValue;
  }

  if (value === undefined)
    return 'PrivateToken credential has no token parameter';
  if (seen > 1)
    return 'PrivateToken credential has more than one token parameter';
  if (value.length > Math.ceil(TOKEN_SIZE / 3) * 4) {
    return 'PrivateToken token exceeds the encoded token size';
  }
  if (!/^[A-Za-z0-9\-_=]+$/.test(value)) {
    return 'PrivateToken token is not base64url';
  }
  try {
    return fromBase64(value);
  } catch {
    return 'PrivateToken token is not valid base64url';
  }
}

/**
 * Matches the stable bearer challenge: Link's issuer name, empty origin_info,
 * and empty redemption_context. A key-bound challenge is deliberately rejected
 * because token verification alone cannot establish possession of an agent key.
 */
export async function challengeDigestMatches(params: {
  issuerName: string;
  presented: Uint8Array;
}): Promise<{ matched: boolean; bindingMode: 'bearer' }> {
  const expected = await sha256(
    encodeTokenChallenge({ issuerName: params.issuerName }),
  );
  return {
    matched: timingSafeEqual(expected, params.presented),
    bindingMode: 'bearer',
  };
}

/** Verifies the blind-RSA authenticator over the token input. */
export async function verifyTokenSignature(
  token: ParsedToken,
  issuerKey: ResolvedTokenKey,
): Promise<boolean> {
  return verifyRsaPss(issuerKey.key, token.authenticator, token.tokenInput);
}
