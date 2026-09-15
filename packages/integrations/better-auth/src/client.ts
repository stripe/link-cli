import type { linkSocialAccount } from 'better-auth/api';
import type {
  BetterAuthClientPlugin,
  BetterFetchOption,
  BetterFetchResponse,
} from 'better-auth/client';
import type { z } from 'zod';
import type { link } from './index';

export type LinkConnectOptions = Omit<
  z.input<typeof linkSocialAccount.options.body>,
  'provider' | 'idToken'
>;

type LinkConnectResult<Throw extends boolean> = BetterFetchResponse<
  { url: string; redirect: boolean },
  { code: string; message: string },
  Throw
>;

export function linkClient() {
  return {
    id: 'link',
    $InferServerPlugin: {} as ReturnType<typeof link>,
    pathMethods: { '/link/disconnect': 'POST' },
    getActions: ($fetch) => ({
      link: {
        connect: <Throw extends boolean = false>(
          options: LinkConnectOptions = {},
          fetchOptions?: Omit<BetterFetchOption, 'throw'> & { throw?: Throw },
        ) =>
          $fetch('/link-social', {
            ...fetchOptions,
            throw: fetchOptions?.throw ?? false,
            method: 'POST',
            body: { ...options, provider: 'link' },
          }) as Promise<LinkConnectResult<Throw>>,
      },
    }),
  } satisfies BetterAuthClientPlugin;
}
