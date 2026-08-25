export const DEFAULT_CREDENTIAL_HEADER = 'Authorization';
export const PAYMENT_AUTHORIZATION_HEADER = 'Payment-Authorization';

export type PaymentCredentialHeader =
  | typeof DEFAULT_CREDENTIAL_HEADER
  | typeof PAYMENT_AUTHORIZATION_HEADER;

/**
 * HTTP field the client must use for the Payment credential.
 *
 * mppx 0.8.x drops unknown WWW-Authenticate auth-params (including `header`)
 * when parsing challenges, so this reads `header` from the raw challenge
 * string. The protocol only allows Authorization (omitted / default) or
 * Payment-Authorization.
 */
export function resolvePaymentCredentialHeader(
  wwwAuthenticate: string,
  challengeId: string,
): PaymentCredentialHeader {
  const chunk = paymentSchemeChunks(wwwAuthenticate).find(
    (scheme) => authParam(scheme, 'id') === challengeId,
  );
  return canonicalizeCredentialHeader(
    chunk ? authParam(chunk, 'header') : undefined,
  );
}

export function canonicalizeCredentialHeader(
  value: string | undefined,
): PaymentCredentialHeader {
  if (value == null || value === '') {
    return DEFAULT_CREDENTIAL_HEADER;
  }
  if (equalsHeaderName(value, DEFAULT_CREDENTIAL_HEADER)) {
    return DEFAULT_CREDENTIAL_HEADER;
  }
  if (equalsHeaderName(value, PAYMENT_AUTHORIZATION_HEADER)) {
    return PAYMENT_AUTHORIZATION_HEADER;
  }
  throw new Error(
    `Unsupported payment credential header "${value}". Only Authorization (default) and Payment-Authorization are supported.`,
  );
}

export function shouldEchoCredentialHeader(
  header: PaymentCredentialHeader,
): boolean {
  return header === PAYMENT_AUTHORIZATION_HEADER;
}

function equalsHeaderName(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function paymentSchemeChunks(wwwAuthenticate: string): string[] {
  const starts: number[] = [];
  for (const match of wwwAuthenticate.matchAll(/Payment\s+/gi)) {
    if (match.index !== undefined) starts.push(match.index);
  }
  return starts.map((start, index) => {
    const nextStart = starts[index + 1];
    const end = nextStart === undefined ? wwwAuthenticate.length : nextStart;
    return wwwAuthenticate.slice(start, end).replace(/,\s*$/, '');
  });
}

function authParam(chunk: string, name: string): string | undefined {
  const pattern = new RegExp(
    `(?:^|[,\\s])${name}\\s*=\\s*(?:"((?:\\\\.|[^"\\\\])*)"|([^,\\s]+))`,
    'i',
  );
  const match = chunk.match(pattern);
  if (!match) return undefined;
  if (match[1] !== undefined) return match[1].replace(/\\(.)/g, '$1');
  return match[2];
}
