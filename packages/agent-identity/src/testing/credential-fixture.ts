/**
 * A stand-in for a Link-issued SD-JWT-VC and a holder presenting it.
 *
 * Real crypto, not a mock: a genuine Ed25519 issuer key signs the credential, a
 * separate holder key signs the KB-JWT, and the digests are computed the way
 * RFC 9901 specifies. That matters because the mistakes worth catching in this
 * lane are all encoding mistakes, and a mock cannot make them.
 *
 * Exported so a verifier integrating this SDK can test its own 401 handling
 * without reimplementing SD-JWT-VC. Everything a presentation needs to be made
 * *wrong* is reachable through `present()`, so negative tests are writable too.
 */
import { asBufferSource, toBase64url, utf8 } from '../internal/bytes.js';
import { type Jwk, jwkThumbprint, sha256 } from '../internal/crypto.js';

const subtle = globalThis.crypto.subtle;

const CREDENTIAL_KID = 'link-cred-1';

export interface PresentOptions {
  /** The verifier this presentation is for. Becomes the KB-JWT `aud`. */
  aud: string;
  /** The nonce from the challenge being answered. */
  nonce: string;
  /** Claim names to disclose. Anything omitted stays hidden. */
  disclose: string[];
  /** Overrides `sd_hash`, to test that the binding is actually checked. */
  sdHashOverride?: string;
  /** Overrides the KB-JWT `typ`, which must be `kb+jwt`. */
  typOverride?: string;
  /** Overrides the KB-JWT `iat`. */
  iat?: number;
}

export interface CredentialFixtureOptions {
  issuerUrl: string;
  claims: Record<string, unknown>;
  /** Omit `exp`, to test that a credential without one is refused. */
  omitExp?: boolean;
  /** Overrides the issuer JWT `typ`, which must be `dc+sd-jwt` or `vc+sd-jwt`. */
  typOverride?: string;
  /** Seconds from now until `exp`. Negative mints an already-expired credential. */
  expiresInSeconds?: number;
  /**
   * Extra top-level members merged into the credential payload.
   *
   * For minting a *validly signed* credential whose structure is wrong, which is
   * the only way to reach the checks that run after signature verification. A
   * hand-assembled unsigned credential cannot test them, because it is rejected
   * earlier and for a different reason.
   */
  extraPayload?: Record<string, unknown>;
  /** Rewrites the computed `_sd` digest list, e.g. to repeat one. */
  rewriteSd?: (digests: string[]) => unknown;
  /**
   * Additional raw disclosure strings, committed to in `_sd` and presented.
   * Each is the base64url of whatever JSON you want, so a reserved claim name or
   * a two-element array-element disclosure is reachable.
   */
  extraDisclosures?: unknown[];
}

export class CredentialFixture {
  readonly issuerJwt: string;
  readonly disclosures: readonly string[];
  readonly holderThumbprint: string;
  readonly issuerJwk: Jwk;

  private readonly claimNames: string[];
  private readonly holderPrivateKey: CryptoKey;
  private readonly issuerUrl: string;
  private readonly alwaysPresent: string[];

  private constructor(init: {
    issuerJwt: string;
    disclosures: string[];
    holderThumbprint: string;
    issuerJwk: Jwk;
    claimNames: string[];
    holderPrivateKey: CryptoKey;
    issuerUrl: string;
    alwaysPresent: string[];
  }) {
    this.issuerJwt = init.issuerJwt;
    this.disclosures = init.disclosures;
    this.holderThumbprint = init.holderThumbprint;
    this.issuerJwk = init.issuerJwk;
    this.claimNames = init.claimNames;
    this.holderPrivateKey = init.holderPrivateKey;
    this.issuerUrl = init.issuerUrl;
    this.alwaysPresent = init.alwaysPresent;
  }

  static async create(
    options: CredentialFixtureOptions,
  ): Promise<CredentialFixture> {
    const issuerPair = (await subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const issuerJwk = await exportPublicJwk(issuerPair.publicKey);
    issuerJwk.kid = CREDENTIAL_KID;

    const holderPair = (await subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const holderJwk = await exportPublicJwk(holderPair.publicKey);

    // One disclosure per claim: [salt, name, value], per RFC 9901 section 4.2.
    const disclosures: string[] = [];
    const sd: string[] = [];
    const claimNames = Object.keys(options.claims);
    for (const name of claimNames) {
      const salt = toBase64url(
        globalThis.crypto.getRandomValues(new Uint8Array(16)),
      );
      const disclosure = segment([salt, name, options.claims[name]]);
      disclosures.push(disclosure);
      // The digest is over the base64url *string*, not the decoded bytes.
      sd.push(toBase64url(await sha256(utf8(disclosure))));
    }

    // Raw extras, committed to and always presented. These exist so a structurally
    // invalid disclosure can be carried by an otherwise valid, correctly signed
    // credential.
    const alwaysPresent: string[] = [];
    for (const raw of options.extraDisclosures ?? []) {
      const disclosure = segment(raw);
      alwaysPresent.push(disclosure);
      sd.push(toBase64url(await sha256(utf8(disclosure))));
    }

    const header = segment({
      alg: 'EdDSA',
      typ: options.typOverride ?? 'dc+sd-jwt',
      kid: CREDENTIAL_KID,
    });
    const now = Math.floor(Date.now() / 1000);
    const payload = segment({
      iss: options.issuerUrl,
      vct: `${options.issuerUrl}/identity/credentials/v1`,
      ...(options.omitExp === true
        ? {}
        : { exp: now + (options.expiresInSeconds ?? 86400) }),
      cnf: { jwk: holderJwk },
      _sd: options.rewriteSd !== undefined ? options.rewriteSd(sd) : sd,
      _sd_alg: 'sha-256',
      ...(options.extraPayload ?? {}),
    });
    const issuerSig = new Uint8Array(
      await subtle.sign(
        { name: 'Ed25519' },
        issuerPair.privateKey,
        asBufferSource(utf8(`${header}.${payload}`)),
      ),
    );

    return new CredentialFixture({
      issuerJwt: `${header}.${payload}.${toBase64url(issuerSig)}`,
      disclosures,
      holderThumbprint: await jwkThumbprint(holderJwk),
      issuerJwk,
      claimNames,
      holderPrivateKey: holderPair.privateKey,
      issuerUrl: options.issuerUrl,
      alwaysPresent,
    });
  }

  /** Builds a holder presentation disclosing the named claims. */
  async present(options: PresentOptions): Promise<string> {
    const kept: string[] = [];
    for (let i = 0; i < this.disclosures.length; i++) {
      const name = this.claimNames[i];
      const disclosure = this.disclosures[i];
      if (
        name !== undefined &&
        disclosure !== undefined &&
        options.disclose.includes(name)
      ) {
        kept.push(disclosure);
      }
    }
    // The trailing tilde is part of what `sd_hash` covers.
    const sdPart = `${[this.issuerJwt, ...kept, ...this.alwaysPresent].join('~')}~`;
    const kbHeader = segment({
      typ: options.typOverride ?? 'kb+jwt',
      alg: 'EdDSA',
    });
    const kbPayload = segment({
      aud: options.aud,
      nonce: options.nonce,
      iat: options.iat ?? Math.floor(Date.now() / 1000),
      sd_hash:
        options.sdHashOverride ?? toBase64url(await sha256(utf8(sdPart))),
    });
    const kbSig = new Uint8Array(
      await subtle.sign(
        { name: 'Ed25519' },
        this.holderPrivateKey,
        asBufferSource(utf8(`${kbHeader}.${kbPayload}`)),
      ),
    );
    return `${sdPart}${kbHeader}.${kbPayload}.${toBase64url(kbSig)}`;
  }

  /** Serves this credential issuer's JWKS at the well-known location. */
  fetchImpl(): typeof fetch {
    const jwksUrl = `${this.issuerUrl}/.well-known/aap-issuer/jwks.json`;
    const jwk = this.issuerJwk;
    return (async (input: RequestInfo | URL) => {
      if (input.toString() === jwksUrl) {
        return new Response(JSON.stringify({ keys: [jwk] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
  }
}

async function exportPublicJwk(key: CryptoKey): Promise<Jwk> {
  const jwk = (await subtle.exportKey('jwk', key)) as Jwk & {
    key_ops?: unknown;
    ext?: unknown;
  };
  // WebCrypto adds these on export; they are not part of a published JWK and
  // some runtimes refuse to import a key that carries them.
  delete jwk.key_ops;
  delete jwk.ext;
  return jwk;
}

function segment(value: unknown): string {
  return toBase64url(utf8(JSON.stringify(value)));
}
