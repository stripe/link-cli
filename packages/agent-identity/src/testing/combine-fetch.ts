/**
 * Merges several fixture `fetch` implementations into one.
 *
 * A test can need Link's issuer metadata and credential JWKS reachable at once.
 * Each fixture serves only
 * its own URLs and 404s everything else, so trying them in order and taking the
 * first non-404 gives one `fetch` that serves all of them.
 */
export function combineFetch(...impls: (typeof fetch)[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    for (const impl of impls) {
      const response = await impl(input as RequestInfo, init);
      if (response.status !== 404) return response;
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}
