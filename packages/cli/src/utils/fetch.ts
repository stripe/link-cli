/**
 * Fetch wrapper that applies default headers only when the caller did not
 * already set that header (case-insensitive). Used so `mpp pay` merchant
 * requests inherit `User-Agent: link-cli/<version> (…)` while `-H User-Agent`
 * still overrides.
 */
export function withDefaultHeaders(
  baseFetch: typeof globalThis.fetch,
  defaultHeaders: Record<string, string>,
): typeof globalThis.fetch {
  if (Object.keys(defaultHeaders).length === 0) {
    return baseFetch;
  }

  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    for (const [key, value] of Object.entries(defaultHeaders)) {
      if (!headers.has(key)) {
        headers.set(key, value);
      }
    }
    return baseFetch(input, { ...init, headers });
  }) as typeof globalThis.fetch;
}
