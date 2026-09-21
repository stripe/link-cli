export interface MppRequest {
  url: string;
  method: string;
  headers: Headers;
  body: string | undefined;
}

function isHttpLoopback(url: URL): boolean {
  return (
    url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' ||
      url.hostname === 'localhost' ||
      url.hostname === '[::1]')
  );
}

function assertSafeMppUrl(url: URL): void {
  if (url.protocol === 'https:' || isHttpLoopback(url)) return;
  throw new Error(
    `MPP requests require HTTPS (HTTP is allowed only for localhost development): ${url.href}`,
  );
}

export function createMppRequest(
  url: string,
  method: string,
  body: string | undefined,
  headers: HeadersInit,
): MppRequest {
  const parsed = new URL(url);
  assertSafeMppUrl(parsed);
  return {
    url: parsed.href,
    method: method.toUpperCase(),
    headers: new Headers(headers),
    body,
  };
}

export function isRedirectResponse(response: Response): boolean {
  return response.status >= 300 && response.status < 400;
}

export function createSafeMppFetch(
  fetcher: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    assertSafeMppUrl(url);
    return fetcher(input, init);
  };
}

export async function fetchMppRequest(
  request: MppRequest,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  // Keep redirects visible so probing can follow them safely and approved
  // payment flows can reject them.
  return fetcher(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: 'manual',
  });
}
