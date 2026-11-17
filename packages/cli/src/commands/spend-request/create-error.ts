import { type CreateSpendRequestParams, LinkApiError } from '@stripe/link-sdk';

const MISSING_LPT_NETWORK_ID_ERROR_MESSAGE =
  'network_id is required when credential_type is link_pay_token';

export const MISSING_LPT_MERCHANT_ERROR = {
  code: 'INVALID_INPUT',
  message:
    'merchant-account-id is required when credential-type is link_pay_token',
} as const;

export function getMissingLptMerchantError(
  params: CreateSpendRequestParams,
  error: unknown,
): typeof MISSING_LPT_MERCHANT_ERROR | undefined {
  if (
    params.credential_type !== 'link_pay_token' ||
    params.merchant_account_id !== undefined ||
    params.network_id !== undefined ||
    !(error instanceof LinkApiError) ||
    error.status !== 400
  ) {
    return undefined;
  }
  const details = error.details as { error?: { message?: string } } | undefined;
  // Preserve the CLI's existing error when the backend rejects missing IDs.
  return details?.error?.message === MISSING_LPT_NETWORK_ID_ERROR_MESSAGE
    ? MISSING_LPT_MERCHANT_ERROR
    : undefined;
}
