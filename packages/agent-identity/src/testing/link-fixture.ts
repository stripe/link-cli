/**
 * A stand-in for Link's issuer, used to mint genuine AATs in tests.
 *
 * This is deliberately real crypto rather than a mock. The useful shortcut: a
 * redeemed AAT's authenticator is an ordinary RSASSA-PSS signature over the
 * token input, because the blinding all cancels out client-side. So a fixture
 * can sign the token input directly and produce a token indistinguishable from
 * one that went through blind issuance.
 */

import { encodeTokenChallenge } from '../attestation.js';
import {
  asBufferSource,
  concat,
  toBase64url,
  uint16be,
} from '../internal/bytes.js';
import { sha256 } from '../internal/crypto.js';
import { parseRsaSpki, wrapRsaSsaPssSpki } from '../internal/der.js';

const subtle = globalThis.crypto.subtle;

/**
 * Which SubjectPublicKeyInfo encoding the fixture publishes.
 *
 * `id-RSASSA-PSS` is what RFC 9578 section 6.5 mandates and what Link actually
 * serves, so it is the default. `rsaEncryption` exists because it is what
 * WebCrypto's `exportKey` emits, and a verifier should tolerate it; keeping it
 * reachable makes that tolerance testable.
 */
export type TokenKeyEncoding = 'id-RSASSA-PSS' | 'rsaEncryption';

export interface MintedToken {
  raw: Uint8Array;
  authorization: string;
  nonce: Uint8Array;
}

export interface MintOptions {
  /** Which of the fixture's published keys signs the token. */
  keyIndex?: number | undefined;
  /**
   * Raw 32-byte RFC 7638 thumbprint of the presenting agent key. Supplying it
   * switches the token to key-bound mode by putting the thumbprint in the
   * redemption context.
   */
  agentKeyThumbprint?: Uint8Array | undefined;
  /** Flips a byte of the authenticator, to test that it is actually verified. */
  corruptAuthenticator?: boolean | undefined;
  /** Mints against a challenge digest the verifier does not issue. */
  challengeDigestOverride?: Uint8Array | undefined;
}

export class LinkFixture {
  readonly issuer: string;
  private keys: {
    privateKey: CryptoKey;
    spkiDer: Uint8Array;
    spkiBase64url: string;
    tokenKeyId: Uint8Array;
    notBefore?: number | undefined;
  }[] = [];

  private constructor(issuer: string) {
    this.issuer = issuer;
  }

  static async create(
    issuer = 'https://api.link.com',
    keyCount = 1,
  ): Promise<LinkFixture> {
    const fixture = new LinkFixture(issuer);
    for (let i = 0; i < keyCount; i++) await fixture.addKey();
    return fixture;
  }

  get issuerName(): string {
    return new URL(this.issuer).host;
  }

  /** Adds a signing key, as a rotation would. Returns its index. */
  async addKey(
    options: { notBefore?: number; encoding?: TokenKeyEncoding } = {},
  ): Promise<number> {
    const pair = (await subtle.generateKey(
      {
        name: 'RSA-PSS',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-384',
      },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;

    // WebCrypto exports `rsaEncryption`. Re-wrap it in the encoding RFC 9578
    // requires an issuer to publish, so the fixture stresses the same import path
    // Link's real directory does. Publishing the export form instead is what let
    // a full green suite coexist with a verifier that could not read a real key.
    const exported = new Uint8Array(
      await subtle.exportKey('spki', pair.publicKey),
    );
    let spkiDer: Uint8Array = exported;
    if ((options.encoding ?? 'id-RSASSA-PSS') === 'id-RSASSA-PSS') {
      const parsed = parseRsaSpki(exported);
      if (typeof parsed === 'string') throw new Error(`fixture key: ${parsed}`);
      spkiDer = wrapRsaSsaPssSpki(parsed.rsaPublicKey);
    }

    this.keys.push({
      privateKey: pair.privateKey,
      spkiDer,
      spkiBase64url: toBase64url(spkiDer),
      // Hashed over the published bytes, which is what the issuer and agent hash.
      tokenKeyId: await sha256(spkiDer),
      notBefore: options.notBefore,
    });
    return this.keys.length - 1;
  }

  /** Removes a key from the published directory, as a rotation without overlap would. */
  retireKey(index: number): void {
    this.keys.splice(index, 1);
  }

  /**
   * Mints a token. `agentKeyThumbprint` switches to key-bound mode by putting
   * the raw thumbprint in the redemption context.
   */
  async mint(options: MintOptions = {}): Promise<MintedToken> {
    const key = this.keys[options.keyIndex ?? 0];
    if (!key) throw new Error('no such fixture key');

    const challengeDigest =
      options.challengeDigestOverride ??
      (await sha256(
        encodeTokenChallenge({
          issuerName: this.issuerName,
          redemptionContext: options.agentKeyThumbprint,
        }),
      ));

    const nonce = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const tokenInput = concat(
      uint16be(0x0002),
      nonce,
      challengeDigest,
      key.tokenKeyId,
    );

    let authenticator = new Uint8Array(
      await subtle.sign(
        { name: 'RSA-PSS', saltLength: 48 },
        key.privateKey,
        asBufferSource(tokenInput),
      ),
    );
    if (options.corruptAuthenticator) {
      authenticator = new Uint8Array(authenticator);
      authenticator[0] = (authenticator[0] as number) ^ 0xff;
    }

    const raw = concat(tokenInput, authenticator);
    return {
      raw,
      authorization: `PrivateToken token="${toBase64url(raw)}"`,
      nonce,
    };
  }

  /** A fetch implementation serving this fixture's discovery documents. */
  fetchImpl(): typeof fetch {
    return (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === `${this.issuer}/.well-known/aap-issuer`) {
        return jsonResponse({
          issuer: this.issuer,
          token_issuance_endpoint: `${this.issuer}/identity/attestations`,
          token_keys: `${this.issuer}/.well-known/aap-issuer/token-keys`,
          claims_jwks_uri: `${this.issuer}/.well-known/aap-issuer/jwks.json`,
          credential_endpoint: `${this.issuer}/identity/credentials`,
          claims_supported: [
            'email',
            'email_verified',
            'given_name',
            'family_name',
            'phone_number',
            'phone_number_verified',
          ],
        });
      }
      if (url === `${this.issuer}/.well-known/aap-issuer/token-keys`) {
        return jsonResponse({
          'token-keys': this.keys.map((k) => ({
            'token-type': 0x0002,
            'token-key': k.spkiBase64url,
            ...(k.notBefore !== undefined ? { 'not-before': k.notBefore } : {}),
          })),
        });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
