/**
 * The Link trust anchor.
 *
 * This SDK is deliberately single-issuer: Link is the only identity provider it
 * will trust, and there is no API for adding others.
 */
import {
  fromBase64,
  quoteForMessage,
  toBase64url,
  toHex,
} from './internal/bytes.js';
import { importTokenKey, sha256 } from './internal/crypto.js';
import { boundedGet, parseJson } from './internal/http.js';
import { trimTrailingSlashes } from './internal/strings.js';

/** Link's production issuer. */
export const LINK_ISSUER = 'https://api.link.com';

/** Privacy Pass token type: Blind RSA, publicly verifiable (RFC 9578 §8.2.2). */
export const TOKEN_TYPE_BLIND_RSA = 0x0002;

interface IssuerMetadata {
  issuer: string;
  token_issuance_endpoint: string;
  token_keys: string;
  claims_jwks_uri?: string;
  credential_endpoint?: string;
  claims_supported?: string[];
}

interface TokenKeyEntry {
  'token-type': number;
  'token-key': string;
  /** RFC 9578 §8.3, optional: the key is not usable before this time. */
  'not-before'?: number;
}

export interface ResolvedTokenKey {
  /** base64url of the full 32-byte token_key_id. */
  tokenKeyId: string;
  /** Imported RSA-PSS verification key. */
  key: CryptoKey;
  /** base64url SPKI DER, as published. Echoed in the challenge's `token-key`. */
  spkiBase64url: string;
  notBefore?: number | undefined;
  /** When this key was last seen in the published directory. */
  lastSeen: number;
  /**
   * The refresh generation this key last appeared in. Compared against the
   * current generation to decide whether the issuer still advertises it.
   * A counter rather than a timestamp, because a retirement and the refresh
   * that observes it routinely fall inside the same second.
   */
  seenInGeneration: number;
}

export interface IssuerOptions {
  /**
   * Override the issuer origin. Intended for staging and for tests against a
   * local fixture server, not for pointing this SDK at a different provider.
   */
  issuer?: string;
  /** Minimum seconds between routine directory fetches. Default 300. */
  minRefreshSeconds?: number;
  /**
   * Maximum seconds a cached key is trusted without being re-observed in the
   * published directory. Default 900.
   *
   * This is the ceiling that `minRefreshSeconds` is the floor of, and without it
   * a verify-only deployment never revalidates at all: a cache hit short-circuits
   * before any staleness check, so a key Link has revoked stays trusted for the
   * lifetime of the process. Set to 0 to disable, and understand that doing so
   * means revocation depends on the process restarting.
   */
  maxKeyAgeSeconds?: number;
  /**
   * Seconds to wait after a failed directory fetch before trying again.
   * Default 30.
   *
   * Without it there is no negative caching: a directory returning errors is
   * re-fetched once per inbound request, which turns an issuer outage into
   * amplified load against the issuer at the moment it is least able to take it.
   */
  refreshFailureBackoffSeconds?: number;
  /**
   * Minimum seconds between directory fetches provoked by an unrecognized
   * `token_key_id`. Default 5.
   *
   * An unknown key id is the signal that the issuer rotated, so it should bypass
   * `minRefreshSeconds`. But it arrives on an unauthenticated request, and an
   * attacker can mint one for free, so bypassing the interval entirely lets any
   * caller drive one upstream fetch per request. This throttles that path on its
   * own clock, leaving genuine rotations fast without making the door an
   * amplifier.
   */
  minForcedRefreshSeconds?: number;
  /**
   * Seconds to keep honouring a key after it stops appearing in the published
   * directory. Default 0, meaning a key is trusted only while advertised.
   *
   * Raising this trades correctness for availability across an issuer key
   * rotation: AATs already sitting in an agent's pool carry the old
   * `token_key_id`, and once the directory drops that key they stop verifying.
   * The clean fix is for the issuer to advertise the old and new key together
   * for at least the pool lifetime. Set this
   * only if you need to survive a rotation that did not overlap, and understand
   * that you are accepting a key the issuer no longer vouches for.
   */
  retiredKeyGraceSeconds?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Deadline for each directory fetch. Default 3000ms. */
  timeoutMs?: number;
  /** Ceiling on a directory response body. Default 256 KiB. */
  maxBytes?: number;
  /**
   * Permit a private, loopback, or plain-http issuer origin.
   *
   * Needed for a local fixture server, which is what `issuer` is documented for.
   * Never enable this in production.
   */
  allowPrivateAddresses?: boolean;
}

export class LinkIssuer {
  readonly issuer: string;
  private readonly minRefreshSeconds: number;
  private readonly maxKeyAgeSeconds: number;
  private readonly refreshFailureBackoffSeconds: number;
  private readonly minForcedRefreshSeconds: number;
  private readonly retiredKeyGraceSeconds: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly allowPrivateAddresses: boolean;

  private metadata?: IssuerMetadata;
  private keys = new Map<string, ResolvedTokenKey>();
  private lastRefresh = 0;
  /** When the last refresh attempt failed, for backoff. 0 means no recent failure. */
  private lastFailure = 0;
  /** Why the last refresh attempt failed, so callers can report it. */
  private lastFailureReason?: string | undefined;
  /** When a forced refresh was last permitted, throttled separately. */
  private lastForcedRefresh = 0;
  /** Bumped on each successful directory fetch. */
  private generation = 0;
  private inFlight?: { promise: Promise<void>; startedAt: number } | undefined;
  /**
   * Keys the directory advertised that this profile will not accept, by
   * token_key_id, with the reason. Kept so `unknown_issuer` on a key Link really
   * does publish can be explained instead of guessed at.
   */
  private readonly unusableKeys = new Map<string, string>();

  constructor(options: IssuerOptions = {}) {
    this.issuer = trimTrailingSlashes(options.issuer ?? LINK_ISSUER);
    this.minRefreshSeconds = options.minRefreshSeconds ?? 300;
    this.maxKeyAgeSeconds = options.maxKeyAgeSeconds ?? 900;
    this.refreshFailureBackoffSeconds =
      options.refreshFailureBackoffSeconds ?? 30;
    this.minForcedRefreshSeconds = options.minForcedRefreshSeconds ?? 5;
    this.retiredKeyGraceSeconds = options.retiredKeyGraceSeconds ?? 0;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.timeoutMs = options.timeoutMs ?? 3000;
    this.maxBytes = options.maxBytes ?? 256 * 1024;
    this.allowPrivateAddresses = options.allowPrivateAddresses ?? false;
  }

  /**
   * Fetches a document from the issuer origin within a bounded budget.
   *
   * The verifier requires every issuer endpoint and key URL to be same-origin
   * with the issuer, fetched over HTTPS, with no cross-origin redirects: an open
   * redirect or a metadata document naming an off-origin `token_keys` would
   * otherwise swap out the trust anchor the entire verifier reduces to.
   * `requireOrigin` and the refusal to follow redirects are that requirement.
   */
  private async getFromIssuer(url: string): Promise<unknown> {
    const result = await boundedGet(url, {
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
      maxBytes: this.maxBytes,
      requireOrigin: new URL(this.issuer).origin,
      allowPrivateAddresses: this.allowPrivateAddresses,
    });
    if (!result.ok) throw new Error(result.reason);
    const body = parseJson(result.text);
    if (typeof body === 'string') throw new Error(body);
    return body;
  }

  /** The `issuer_name` used in the TokenChallenge: the issuer's host. */
  get issuerName(): string {
    return new URL(this.issuer).host;
  }

  /**
   * Resolves a token_key_id to a trusted key, refreshing the directory once if
   * the id is unknown. Returns undefined when the id does not resolve, which
   * the caller must treat as `unknown_issuer` rather than as a soft failure.
   */
  async resolveKey(tokenKeyId: string): Promise<ResolvedTokenKey | undefined> {
    const hit = this.keys.get(tokenKeyId);
    if (hit !== undefined && this.isUsable(hit) && this.isFresh(hit))
      return hit;

    // An id that does not resolve to a usable key is the expected signal that the
    // issuer rotated, so bypass the routine interval.
    //
    // The condition is deliberately usability rather than presence. Keying it on
    // `!hit` meant a key that was present but stale left `force` false, so the
    // routine interval suppressed the very refresh that would have restored it,
    // and the verifier rejected all traffic for the whole interval while making
    // no attempt to recover.
    const startedAt = this.now();
    if (hit !== undefined && this.isUsable(hit) && !this.isFresh(hit)) {
      // A known key reaching its age limit needs revalidation, regardless of the
      // separate throttle for unrecognized key IDs. refresh() still coalesces
      // concurrent calls and enforces outage backoff.
      await this.refresh({ force: true });
    } else {
      await this.refreshForUnrecognizedKey();
    }

    const after = this.keys.get(tokenKeyId);
    if (after !== undefined && this.isUsable(after) && this.isFresh(after))
      return after;

    // The refresh may have been an in-flight one whose directory read predates
    // this caller, in which case it could not have seen a key published since.
    // One retry, and only when that is actually what happened.
    if (this.lastRefresh < startedAt) {
      await this.refreshForUnrecognizedKey();
      const retried = this.keys.get(tokenKeyId);
      if (
        retried !== undefined &&
        this.isUsable(retried) &&
        this.isFresh(retried)
      )
        return retried;
    }
    return undefined;
  }

  /**
   * Refresh provoked by a `token_key_id` this verifier does not recognize.
   *
   * Kept separate from the public `refresh` because the two have opposite needs.
   * An unknown key id is reachable by any unauthenticated caller and is free to
   * mint, so this path must be rate limited or the front door becomes an
   * amplifier pointed at the issuer. An explicit `refresh()` call is an operator
   * action and must never be silently suppressed.
   */
  private async refreshForUnrecognizedKey(): Promise<void> {
    // Waiting for an existing fetch does not create more issuer traffic.
    // Throttling before this join can reject valid tokens against an empty cache.
    if (this.inFlight !== undefined) return this.inFlight.promise;
    if (
      this.lastFailureReason !== undefined &&
      this.now() - this.lastFailure < this.refreshFailureBackoffSeconds
    ) {
      throw new Error(this.lastFailureReason);
    }
    if (this.now() - this.lastForcedRefresh < this.minForcedRefreshSeconds)
      return;
    this.lastForcedRefresh = this.now();
    await this.refresh({ force: true });
  }

  /**
   * Why a `token_key_id` did not resolve, when the directory did advertise it but
   * this profile refused it. Returns undefined when the id was simply not present.
   */
  explainUnresolved(tokenKeyId: string): string | undefined {
    return this.unusableKeys.get(tokenKeyId);
  }

  /**
   * Keys to advertise in a challenge.
   *
   * `not-before` is applied here and only here. RFC 9578 section 8.3 makes it a
   * client-side SHOULD about *issuance* ("Clients SHOULD NOT use a token key
   * before this timestamp"), and the same section says an origin may attempt any
   * key in the list when verifying, precisely because client clock skew is
   * expected to put tokens either side of the boundary. Excluding a staged key
   * from what we advertise matches the client preference; refusing to verify a
   * token already minted under it does not, and would hard-reject legitimate
   * traffic at exactly the moment of a scheduled rotation.
   */
  async advertisableKeys(): Promise<ResolvedTokenKey[]> {
    await this.refresh();
    const now = this.now();
    return [...this.keys.values()].filter(
      (k) =>
        this.isUsable(k) && (k.notBefore === undefined || now >= k.notBefore),
    );
  }

  private isUsable(entry: ResolvedTokenKey): boolean {
    // Still advertised: trusted.
    if (entry.seenInGeneration === this.generation) return true;
    // Retired. Trusted only inside an explicitly configured grace window.
    if (this.retiredKeyGraceSeconds <= 0) return false;
    return this.now() - entry.lastSeen <= this.retiredKeyGraceSeconds;
  }

  /** Whether this key has been re-observed recently enough to keep trusting. */
  private isFresh(entry: ResolvedTokenKey): boolean {
    if (this.maxKeyAgeSeconds <= 0) return true;
    // For a retired key, a successful directory read revalidates the retirement
    // status; the separately configured grace window still limits acceptance.
    const observedAt =
      entry.seenInGeneration === this.generation
        ? entry.lastSeen
        : this.lastRefresh;
    return this.now() - observedAt <= this.maxKeyAgeSeconds;
  }

  /**
   * Fetches the published directory.
   *
   * `force` bypasses `minRefreshSeconds` but not the failure backoff. An explicit
   * call is never silently throttled; the rate limit that protects the issuer
   * lives on `refreshForUnrecognizedKey`, which is the path an untrusted request
   * can reach.
   */
  async refresh(options: { force?: boolean } = {}): Promise<void> {
    const now = this.now();

    if (
      options.force !== true &&
      now - this.lastRefresh < this.minRefreshSeconds
    ) {
      return;
    }

    // Back off after a failure, so a failing directory is not re-fetched once per
    // inbound request.
    if (
      this.lastFailure !== 0 &&
      now - this.lastFailure < this.refreshFailureBackoffSeconds
    ) {
      throw new Error(this.lastFailureReason ?? 'issuer metadata unavailable');
    }

    // Collapse concurrent refreshes: a burst of unknown key ids at the front
    // door should cost one directory fetch, not one per request. The start time is
    // recorded so a caller can tell whether the refresh it awaited could possibly
    // have seen a key published after the caller's request arrived.
    const inFlight = this.inFlight;
    if (inFlight !== undefined) return inFlight.promise;

    const started = { startedAt: now, promise: Promise.resolve() };
    started.promise = this.doRefresh().finally(() => {
      this.inFlight = undefined;
    });
    this.inFlight = started;
    return started.promise;
  }

  /** The reason the most recent refresh attempt failed, if it did. */
  lastRefreshError(): string | undefined {
    return this.lastFailureReason;
  }

  private async doRefresh(): Promise<void> {
    try {
      await this.fetchAndApplyDirectory();
      this.lastFailure = 0;
      this.lastFailureReason = undefined;
    } catch (error) {
      // Record the failure so backoff applies. Previously `lastRefresh` was only
      // advanced on success and nothing recorded the failure, so an outage cost
      // one upstream fetch per request with no ceiling.
      this.lastFailure = this.now();
      this.lastFailureReason =
        error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  private async fetchAndApplyDirectory(): Promise<void> {
    const metadataUrl = `${this.issuer}/.well-known/aap-issuer`;
    const metadata = (await this.getFromIssuer(
      metadataUrl,
    )) as IssuerMetadata | null;
    if (metadata === null || typeof metadata !== 'object') {
      throw new Error('issuer metadata is not a JSON object');
    }
    if (
      typeof metadata.issuer !== 'string' ||
      typeof metadata.token_keys !== 'string'
    ) {
      throw new Error('issuer metadata omits issuer or token_keys');
    }

    // Refuse a metadata document that claims to be a different issuer: this is
    // the only place the pinned trust anchor is enforced.
    if (trimTrailingSlashes(metadata.issuer) !== this.issuer) {
      throw new Error(
        `issuer metadata declares ${quoteForMessage(metadata.issuer)}, expected ${this.issuer}`,
      );
    }

    const directory = (await this.getFromIssuer(metadata.token_keys)) as {
      'token-keys'?: TokenKeyEntry[];
    } | null;
    const entries = directory?.['token-keys'] ?? [];
    if (!Array.isArray(entries)) {
      throw new Error('token-keys is not an array');
    }

    // Parse and import everything into a staging map BEFORE touching any live
    // state. The previous order bumped the generation first and recorded success
    // last, so a throw partway through the entry loop left every warm key stamped
    // with a superseded generation, i.e. unusable, while `lastRefresh` still said
    // the cache was current. One malformed entry in the directory therefore
    // rejected 100% of traffic until the interval expired, and it did so after the
    // upstream fault had already been corrected.
    const seenAt = this.now();
    const staged = new Map<
      string,
      Omit<ResolvedTokenKey, 'seenInGeneration'>
    >();
    const refused = new Map<string, string>();

    for (const entry of entries) {
      if (entry === null || typeof entry !== 'object') continue;
      if (entry['token-type'] !== TOKEN_TYPE_BLIND_RSA) continue;
      if (typeof entry['token-key'] !== 'string') continue;

      let spkiDer: Uint8Array;
      try {
        spkiDer = fromBase64(entry['token-key']);
      } catch {
        // A single undecodable entry is not grounds for discarding the directory.
        continue;
      }

      // token_key_id is SHA-256 over the bytes exactly as published, per RFC 9578
      // section 6.5. It is deliberately not computed over the re-wrapped form: the
      // issuer and the agent both hashed the published encoding, so hashing
      // anything else would make every token fail to resolve.
      const tokenKeyId = toBase64url(await sha256(spkiDer));

      const existing = this.keys.get(tokenKeyId);
      const key = existing?.key ?? (await importTokenKey(spkiDer));
      if (typeof key === 'string') {
        // One unusable key must not cost the others. A directory can legitimately
        // advertise a key this profile does not accept.
        refused.set(tokenKeyId, key);
        continue;
      }

      staged.set(tokenKeyId, {
        tokenKeyId,
        key,
        spkiBase64url: toBase64url(spkiDer),
        notBefore: entry['not-before'],
        lastSeen: seenAt,
      });
    }

    // A directory that advertises no key this profile can use is a failed
    // refresh, not an empty success. Committing it would retire every warm key.
    if (staged.size === 0) {
      throw new Error(
        entries.length === 0
          ? 'issuer published no token keys'
          : `issuer published ${entries.length} token key(s), none usable by this verifier`,
      );
    }

    // Commit. From here nothing can throw.
    const generation = ++this.generation;
    for (const [tokenKeyId, value] of staged) {
      this.keys.set(tokenKeyId, { ...value, seenInGeneration: generation });
    }
    this.unusableKeys.clear();
    for (const [id, reason] of refused) this.unusableKeys.set(id, reason);
    this.metadata = metadata;
    this.lastRefresh = seenAt;

    // Drop keys that are past the grace window entirely, so the map does not
    // grow without bound across many rotations.
    for (const [id, entry] of this.keys) {
      if (entry.seenInGeneration === generation) continue;
      if (
        this.retiredKeyGraceSeconds <= 0 ||
        seenAt - entry.lastSeen > this.retiredKeyGraceSeconds
      ) {
        this.keys.delete(id);
      }
    }
  }

  /** Metadata, fetching if needed. Used by the claims lane for the issuer JWKS. */
  async getMetadata(): Promise<IssuerMetadata> {
    if (!this.metadata) await this.refresh({ force: true });
    if (!this.metadata) throw new Error('issuer metadata unavailable');
    return this.metadata;
  }

  /** Claims this issuer advertises. Used to reject a challenge Link cannot answer. */
  async claimsSupported(): Promise<string[]> {
    return (await this.getMetadata()).claims_supported ?? [];
  }

  /** Debug helper: hex of a token key id, for logs. */
  static tokenKeyIdHex(tokenKeyId: string): string {
    return toHex(fromBase64(tokenKeyId));
  }
}
