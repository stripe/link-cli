/**
 * Fetches and issues Blind RSA attestations exclusively through api.link.com.
 * This module handles discovery and JSON batch issuance; the cryptographic
 * operations live in attestations-crypto.ts.
 */
import { z } from 'zod';
import type { LinkOptions } from '@/config';
import {
  LinkApiError,
  LinkConfigurationError,
  LinkResponseError,
  LinkTransportError,
} from '@/errors';
import {
  base64urlEncode,
  computeChallengeDigest,
  type FinalToken,
  generateBlindedMessages,
  unblindSignatures,
} from '@/resources/attestations-crypto';
import { BaseResource } from '@/resources/base';
import type {
  AttestationRequestParams,
  AttestationRequestResult,
  IAttestationsResource,
} from '@/resources/interfaces';

const TOKEN_TYPE_BLIND_RSA = 0x0002;
const LINK_ISSUER = 'https://api.link.com';
const LINK_ISSUER_HOSTNAME = 'api.link.com';
const LINK_ISSUER_METADATA_URL = `${LINK_ISSUER}/.well-known/aap-issuer`;

const issuerMetadataSchema = z.looseObject({
  issuer: z.literal(LINK_ISSUER),
  token_issuance_endpoint: z.string(),
  token_keys: z.string(),
});

const tokenKeyDirectorySchema = z.looseObject({
  'token-keys': z.array(
    z.looseObject({
      'token-type': z.number(),
      'token-key': z.string(),
      'not-before': z.number().int().nonnegative().optional(),
    }),
  ),
});

/** Decodes a standard or URL-safe base64 key value. */
function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return new Uint8Array(Buffer.from(normalized, 'base64'));
}

const attestationResponseSchema = z.looseObject({
  attestations: z.array(z.string().nullable()),
});

/** Validates ordered blind signatures before unblinding the complete batch. */
function decodeAttestations(
  body: unknown,
  elementSize: number,
  expectedCount: number,
): string[] {
  const { attestations } = attestationResponseSchema.parse(body);
  if (attestations.length !== expectedCount) {
    throw new Error(
      `Issuer returned ${attestations.length} attestations for ${expectedCount} token requests`,
    );
  }
  return attestations.map((signature, index) => {
    // Never drop a refused slot: each signature belongs to the blind at that index.
    if (signature === null) {
      throw new Error(`Issuer refused token request at index ${index}`);
    }
    const decoded = Buffer.from(signature, 'base64url');
    if (
      !/^[A-Za-z0-9_-]+$/.test(signature) ||
      decoded.length !== elementSize ||
      decoded.toString('base64url') !== signature
    ) {
      throw new Error(`Invalid blind signature encoding at index ${index}`);
    }
    return signature;
  });
}

/** Accepts a discovered endpoint only when it remains on api.link.com. */
function requireLinkEndpoint(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new TypeError(`${field} is not a valid URL`, { cause: error });
  }
  if (
    url.protocol !== 'https:' ||
    url.origin !== LINK_ISSUER ||
    url.username ||
    url.password
  ) {
    throw new TypeError(`${field} must be an HTTPS URL on ${LINK_ISSUER}`);
  }
  return url.href;
}

export class AttestationsResource
  extends BaseResource
  implements IAttestationsResource
{
  /** Creates an attestation resource using the SDK's authentication config. */
  constructor(options: LinkOptions) {
    super(options, '');
  }

  /** Fetches JSON without following redirects and normalizes API errors. */
  private async fetchJson(
    url: string,
    operation: string,
  ): Promise<{ data: unknown; status: number }> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, { redirect: 'manual' });
    } catch (error) {
      throw new LinkTransportError(`Request failed: GET ${url}`, {
        cause: error,
      });
    }

    const rawBody = await response.text();
    if (response.status >= 300 && response.status < 400) {
      throw new LinkApiError(
        `Refused redirect while attempting to ${operation} (${response.status})`,
        {
          status: response.status,
          rawBody,
        },
      );
    }
    let data: unknown = null;
    try {
      data = JSON.parse(rawBody);
    } catch (error) {
      if (response.ok) {
        throw new LinkResponseError(operation, response.status, {
          cause: error,
        });
      }
    }

    if (!response.ok) {
      throw new LinkApiError(
        `Failed to ${operation} (${response.status}): ${rawBody}`,
        {
          status: response.status,
          rawBody,
          details: data,
        },
      );
    }
    return { data, status: response.status };
  }

  /** Sends a blinded batch with the current or refreshed access token. */
  private async issueTokens(
    url: string,
    body: string,
    forceRefresh = false,
  ): Promise<Response> {
    const token = await this.getAccessToken(
      forceRefresh ? { forceRefresh: true } : undefined,
    );
    try {
      return await this.fetchImpl(url, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body,
      });
    } catch (error) {
      throw new LinkTransportError(`Request failed: POST ${url}`, {
        cause: error,
      });
    }
  }

  /** Requests, verifies, and returns a batch of Link attestation tokens. */
  async request(
    params: AttestationRequestParams,
  ): Promise<AttestationRequestResult> {
    const { count } = params;
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      throw new LinkConfigurationError(
        'Attestation token count must be an integer from 1 to 100',
      );
    }
    const metadataResponse = await this.fetchJson(
      LINK_ISSUER_METADATA_URL,
      'fetch issuer metadata',
    );
    const metadata = this.parseResponse(
      'parse issuer metadata',
      metadataResponse.status,
      () => issuerMetadataSchema.parse(metadataResponse.data),
    );
    let tokenKeysUrl: string;
    let issuanceUrl: string;
    try {
      tokenKeysUrl = requireLinkEndpoint(metadata.token_keys, 'token_keys');
      issuanceUrl = requireLinkEndpoint(
        metadata.token_issuance_endpoint,
        'token_issuance_endpoint',
      );
    } catch (error) {
      throw new LinkResponseError(
        'validate issuer metadata',
        metadataResponse.status,
        { cause: error },
      );
    }
    const directoryResponse = await this.fetchJson(
      tokenKeysUrl,
      'fetch token keys',
    );
    const directory = this.parseResponse(
      'parse token key directory',
      directoryResponse.status,
      () => tokenKeyDirectorySchema.parse(directoryResponse.data),
    );
    const now = Math.floor(Date.now() / 1000);
    const tokenKey = directory['token-keys'].find(
      (entry) =>
        entry['token-type'] === TOKEN_TYPE_BLIND_RSA &&
        (entry['not-before'] === undefined || entry['not-before'] <= now),
    );
    if (!tokenKey) {
      throw new LinkResponseError(
        'select Blind RSA token key',
        directoryResponse.status,
        {
          cause: new Error(
            'No active token key with type 0x0002 found in directory',
          ),
        },
      );
    }

    const spkiDer = base64ToBytes(tokenKey['token-key']);
    const challengeDigest = computeChallengeDigest(
      TOKEN_TYPE_BLIND_RSA,
      LINK_ISSUER_HOSTNAME,
    );
    const blindingState = generateBlindedMessages(
      spkiDer,
      count,
      challengeDigest,
    );
    const requestBody = JSON.stringify({
      token_key_id: base64urlEncode(blindingState.tokenKeyId),
      messages: blindingState.tokens.map((token) =>
        base64urlEncode(token.blindedMsg),
      ),
    });

    let issueResponse = await this.issueTokens(issuanceUrl, requestBody);
    if (issueResponse.status === 401 && this.canRefreshAccessToken) {
      issueResponse = await this.issueTokens(issuanceUrl, requestBody, true);
    }

    if (!issueResponse.ok) {
      const rawBody = await issueResponse.text();
      throw new LinkApiError(
        `Failed to issue attestation tokens (${issueResponse.status}): ${rawBody}`,
        {
          status: issueResponse.status,
          rawBody,
        },
      );
    }

    let finalTokens: FinalToken[];
    try {
      const blindSignatures = decodeAttestations(
        await issueResponse.json(),
        blindingState.publicKey.nLen,
        count,
      );
      finalTokens = unblindSignatures(blindingState, blindSignatures);
    } catch (error) {
      throw new LinkResponseError(
        'decode attestation token response',
        issueResponse.status,
        { cause: error },
      );
    }

    return {
      tokens: finalTokens.map((finalToken) => finalToken.base64url),
      issuer: LINK_ISSUER,
      token_key_id: base64urlEncode(blindingState.tokenKeyId),
      count: finalTokens.length,
    };
  }
}
