const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BODY_HEADERS = [
  'content-encoding',
  'content-language',
  'content-length',
  'content-location',
  'content-type',
  'transfer-encoding',
];
const CROSS_ORIGIN_HEADERS = [
  'authorization',
  'cookie',
  'cookie2',
  'host',
  'proxy-authorization',
];

export interface MppRequest {
  url: string;
  method: string;
  headers: Headers;
  body: string | undefined;
}

export interface MppProbe extends MppRequest {
  response: Response;
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

export async function probeMppRequest(
  initial: MppRequest,
  fetcher: typeof fetch = fetch,
  maxRedirects = 10,
): Promise<MppProbe> {
  let request = initial;

  for (let redirectCount = 0; ; redirectCount++) {
    const response = await fetchMppRequest(request, fetcher);
    if (!REDIRECT_STATUSES.has(response.status)) {
      return { ...request, response };
    }

    const location = response.headers.get('location');
    if (!location) return { ...request, response };
    if (redirectCount >= maxRedirects) {
      await response.body?.cancel();
      throw new Error(`MPP request exceeded ${maxRedirects} redirects`);
    }

    // Release this connection before validating or following the next hop.
    await response.body?.cancel();
    const currentUrl = new URL(request.url);
    const nextUrl = new URL(location, currentUrl);
    assertSafeMppUrl(nextUrl);
    if (currentUrl.protocol === 'https:' && nextUrl.protocol !== 'https:') {
      throw new Error(
        `MPP request refused HTTPS downgrade redirect to ${nextUrl.href}`,
      );
    }

    const headers = new Headers(request.headers);
    let method = request.method;
    let body = request.body;
    const switchesToGet =
      ((response.status === 301 || response.status === 302) &&
        method === 'POST') ||
      (response.status === 303 && method !== 'GET' && method !== 'HEAD');
    if (switchesToGet) {
      // Match Fetch redirect behavior: GET has no body or body-specific headers.
      method = 'GET';
      body = undefined;
      for (const header of BODY_HEADERS) headers.delete(header);
    }

    if (currentUrl.origin !== nextUrl.origin) {
      // Fetch does not forward credentials or a caller-supplied Host to another origin.
      for (const header of CROSS_ORIGIN_HEADERS) headers.delete(header);
    }

    request = {
      url: nextUrl.href,
      method,
      headers,
      body,
    };
  }
}
