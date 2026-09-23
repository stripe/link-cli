import type { BetterAuthClientPlugin } from 'better-auth/client';
import { LINK_ERROR_CODES } from './error-codes';
import type { link } from './index';

export const linkClient = () =>
  ({
    id: 'link',
    $InferServerPlugin: {} as ReturnType<typeof link>,
    pathMethods: {
      '/link/connect': 'POST',
      '/link/disconnect': 'POST',
    },
    $ERROR_CODES: LINK_ERROR_CODES,
  }) satisfies BetterAuthClientPlugin;

export { LINK_ERROR_CODES } from './error-codes';
