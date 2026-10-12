/**
 * Bounded outbound fetches.
 *
 * Every network call this library makes is provoked by an inbound request, and
 * some of them go to a host the inbound request named. That makes an unbounded
 * fetch the cheapest denial of service available against a verifier: a directory
 * that accepts a connection and never answers holds the request forever, and one
 * that answers with 24 MB of keys buys thousands of times its own cost in
 * verifier CPU.
 *
 * So there is one place that performs a fetch, and it always has a deadline, a
 * byte ceiling, and a redirect policy. Callers pass a budget rather than being
 * trusted to remember one.
 */
import { quoteForMessage } from './bytes.js';

export interface FetchBudget {
  fetchImpl: typeof fetch;
  /**
   * Permit private, loopback, and link-local destinations, and plain http.
   *
   * For a local issuer or key directory during development. Never set this from
   * anything a request controls: the whole point of the default is that
   * `Signature-Agent` is caller-chosen.
   */
  allowPrivateAddresses?: boolean | undefined;
  /** Wall-clock deadline for the whole request, including reading the body. */
  timeoutMs: number;
  /** Hard ceiling on the response body. */
  maxBytes: number;
  /**
   * Origin the response must come from, if the caller requires one.
   *
   * The verifier requires key URLs to be same-origin with the issuer and forbids
   * cross-origin redirects, because an open redirect would otherwise substitute
   * the trust anchor the whole verifier reduces to.
   */
  requireOrigin?: string | undefined;
}

export type HttpResult =
  | { ok: true; status: number; text: string }
  | { ok: false; reason: string };

/** Hosts that must never be fetched, because they are not on the public internet. */
function isForbiddenHost(hostname: string): boolean {
  // One trailing dot is a fully-qualified spelling of the same name. WHATWG `URL`
  // strips it from an IPv4 literal but keeps it on a name, so `localhost.` reached a
  // real loopback server.
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1' || host === '::' || host === '0.0.0.0') return true;
  if (host === '255.255.255.255') return true;

  // IPv4 literals in private, loopback, link-local, and CGNAT ranges.
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true; // includes 169.254.169.254
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true; // multicast and reserved
    if (a === 192 && b === 0) return true; // 192.0.0.0/24, 192.0.2.0/24
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    return false;
  }

  // IPv4-mapped and IPv4-compatible IPv6, in either textual form. WHATWG `URL`
  // rewrites `::ffff:127.0.0.1` to `::ffff:7f00:1`, so both spellings are checked.
  // `::ffff:x`, `::x`, `::ffff:0:x` (SIIT) and `64:ff9b::x` (NAT64) all address an
  // IPv4 destination, so each has to be judged as that address.
  const mapped =
    /^(?:::(?:ffff:)?(?:0:)?|64:ff9b::)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(
      host,
    );
  if (mapped) return isForbiddenHost(mapped[1] as string);
  const mappedHex =
    /^(?:::(?:ffff:)?(?:0:)?|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(
      host,
    );
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1] as string, 16);
    const low = Number.parseInt(mappedHex[2] as string, 16);
    const dotted = [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
    return isForbiddenHost(dotted);
  }

  // IPv6 unique-local and link-local.
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
  return false;
}

/**
 * Validates a URL before anything is dialled.
 *
 * Returns the parsed URL or a reason. HTTPS only, no credentials, no private or
 * loopback address, and same-origin when the caller requires it.
 */
export function checkFetchTarget(
  rawUrl: string,
  options: {
    requireOrigin?: string | undefined;
    allowedHosts?: readonly string[] | undefined;
    allowPrivateAddresses?: boolean | undefined;
  },
): URL | string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return `${quoteForMessage(rawUrl)} is not a valid absolute URL`;
  }
  const allowPrivate = options.allowPrivateAddresses === true;
  if (
    url.protocol !== 'https:' &&
    !(allowPrivate && url.protocol === 'http:')
  ) {
    return 'key URLs must be https';
  }
  if (url.username !== '' || url.password !== '') {
    return 'key URLs must not carry credentials';
  }
  if (!allowPrivate && isForbiddenHost(url.hostname)) {
    return `refusing to fetch a private or loopback address (${quoteForMessage(url.hostname)})`;
  }
  if (
    options.requireOrigin !== undefined &&
    url.origin !== options.requireOrigin
  ) {
    return `${quoteForMessage(url.origin)} is not same-origin with ${options.requireOrigin}`;
  }
  if (options.allowedHosts !== undefined) {
    // Matched on host and port, not host alone. Comparing the hostname only meant an
    // allow-listed host could be dialled on any port, which turns the verifier into a
    // port-scan oracle against the agent platform: open TLS, open non-TLS, and closed
    // are all distinguishable by reason and timing. An entry without a port means 443.
    const host = url.hostname.toLowerCase();
    const port = url.port === '' ? '443' : url.port;
    const matches = options.allowedHosts.some((entry) => {
      const normalized = entry.toLowerCase().replace(/\.$/, '');
      const separator = normalized.lastIndexOf(':');
      const bracketed = normalized.startsWith('[');
      if (
        separator > 0 &&
        (!bracketed || normalized.indexOf(']') < separator)
      ) {
        return (
          normalized.slice(0, separator).replace(/^\[|\]$/g, '') === host &&
          normalized.slice(separator + 1) === port
        );
      }
      return normalized.replace(/^\[|\]$/g, '') === host && port === '443';
    });
    if (!matches) {
      return `${quoteForMessage(url.host)} is not an allowed key directory host`;
    }
  }
  return url;
}

/**
 * Performs a GET within the given budget.
 *
 * Never throws. A network failure, a timeout, an oversized body, and a redirect
 * are all ordinary conditions here, and the callers are on a request path where
 * an exception is the wrong shape.
 */
export async function boundedGet(
  rawUrl: string,
  budget: FetchBudget,
  allowedHosts?: readonly string[] | undefined,
): Promise<HttpResult> {
  const target = checkFetchTarget(rawUrl, {
    requireOrigin: budget.requireOrigin,
    allowedHosts,
    allowPrivateAddresses: budget.allowPrivateAddresses,
  });
  if (typeof target === 'string') return { ok: false, reason: target };

  const TIMED_OUT = Symbol('timed-out');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The deadline is enforced by racing, not only by aborting the signal.
  // `AbortSignal` is cooperative: a `fetchImpl` that ignores it never settles, and
  // then the abort has nothing listening and the caller waits forever. Platform
  // `fetch` honours the signal, but a caller-supplied one is not obliged to, and
  // "a deadline unless your transport declines" is not a deadline.
  // A unique symbol, not the string 'timeout': `readCapped` resolves to the response
  // text, so a body whose content was literally "timeout" would be misread.
  const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(TIMED_OUT);
    }, budget.timeoutMs);
  });

  try {
    const raced = await Promise.race([
      budget.fetchImpl(target.toString(), {
        // A redirect is refused rather than followed. Following one lets an open
        // redirect on a trusted host point at an untrusted document.
        redirect: 'error',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      }),
      deadline,
    ]);
    if (raced === TIMED_OUT) {
      return {
        ok: false,
        reason: `fetch timed out after ${budget.timeoutMs}ms`,
      };
    }
    const response = raced;

    if (!response.ok) {
      return {
        ok: false,
        reason: `fetch of ${target.pathname} returned ${response.status}`,
      };
    }

    // Check the declared length first, so an oversized body is refused before it
    // is read, then enforce the ceiling again while reading in case the header lied.
    const declared = response.headers.get('content-length');
    if (declared !== null && Number(declared) > budget.maxBytes) {
      // Abort rather than just returning: an unread body holds the connection open,
      // and the peer keeps sending.
      controller.abort();
      return {
        ok: false,
        reason: `response declares ${declared} bytes, over the ${budget.maxBytes} byte limit`,
      };
    }

    const read = await Promise.race([
      readCapped(response, budget.maxBytes),
      deadline,
    ]);
    if (read === TIMED_OUT) {
      return {
        ok: false,
        reason: `reading the response timed out after ${budget.timeoutMs}ms`,
      };
    }
    if (typeof read !== 'string') {
      // Over the ceiling. `maxBytes` bounded retained memory but not the socket, so
      // fifty capped requests left fifty connections open with the peer still sending.
      controller.abort();
      return read;
    }
    return { ok: true, status: response.status, text: read };
  } catch (error) {
    if (controller.signal.aborted) {
      return {
        ok: false,
        reason: `fetch timed out after ${budget.timeoutMs}ms`,
      };
    }
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `fetch failed: ${detail}` };
  } finally {
    // Cleared only once the body has settled or been abandoned, so the deadline stays
    // armed across the read rather than only across the response headers.
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<string | { ok: false; reason: string }> {
  const body = response.body;
  if (body === null) return '';

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) {
        total += value.byteLength;
        if (total > maxBytes) {
          // Release the stream so the connection closes instead of being held while
          // the peer keeps writing.
          void reader.cancel().catch(() => undefined);
          return {
            ok: false,
            reason: `response exceeded the ${maxBytes} byte limit`,
          };
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(joined);
}

/** Parses JSON without throwing. */
export function parseJson(text: string): unknown | string {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return 'response body is not valid JSON';
  }
}

/**
 * A bounded, insertion-ordered cache.
 *
 * Entry limits bound memory use, and each read checks the entry's expiry.
 */
export class BoundedCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlSeconds: number,
    private readonly now: () => number,
  ) {}

  get(key: string): T | undefined {
    const hit = this.entries.get(key);
    if (hit === undefined) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlSeconds });
    // Insertion-ordered, so the first key is the oldest.
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
