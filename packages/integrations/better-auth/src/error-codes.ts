import { defineErrorCodes } from 'better-auth';

export const LINK_ERROR_CODES = defineErrorCodes({
  LINK_REFRESH_TOKEN_NOT_FOUND:
    'Link refresh token is missing. The account remains connected.',
  LINK_REVOCATION_FAILED:
    'Unable to revoke Link access. The account remains connected; try again.',
});
