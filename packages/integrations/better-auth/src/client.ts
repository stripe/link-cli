import type { BetterAuthClientPlugin } from 'better-auth/client';
import type { link } from './index';

export const linkClient = () =>
  ({
    id: 'link',
    $InferServerPlugin: {} as ReturnType<typeof link>,
    pathMethods: {
      '/link/connect': 'POST',
      '/link/disconnect': 'POST',
    },
  }) satisfies BetterAuthClientPlugin;
