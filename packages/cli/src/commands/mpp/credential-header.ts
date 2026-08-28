export const DEFAULT_CREDENTIAL_HEADER = 'Authorization';
export const PAYMENT_AUTHORIZATION_HEADER = 'Payment-Authorization';

export type PaymentCredentialHeader =
  | typeof DEFAULT_CREDENTIAL_HEADER
  | typeof PAYMENT_AUTHORIZATION_HEADER;

/**
 * HTTP field the client must use for the Payment credential.
 *
 * `mppx` parses the challenge `header` auth-param; this only canonicalizes the
 * advertised value. The protocol allows Authorization (omitted / default) or
 * Payment-Authorization.
 */
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
