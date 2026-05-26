import { type AuthStorage, storage as defaultStorage } from '@stripe/link-sdk';
import { Cli } from 'incur';
import React from 'react';
import type { IAuthResource } from '../../auth/types';
import { pollUntil } from '../../utils/poll-until';
import { renderInteractive } from '../../utils/render-interactive';
import { sanitizeDeep } from '../../utils/sanitize-text';
import type { UpdateInfoProvider } from '../../utils/update-info';
import { Login } from './login';
import { Logout } from './logout';
import { loginOptions, statusOptions } from './schema';
import { AuthStatus } from './status';
import { resolveAuthInfo } from './utils';

interface PollAuthOptions {
  interval: number;
  maxAttempts: number;
  timeout: number;
}

async function* pollAuthStatus(
  authResource: IAuthResource,
  storage: AuthStorage,
  opts: PollAuthOptions,
  update?: {
    current_version: string;
    latest_version: string;
    update_command: string;
  },
) {
  for await (const result of pollUntil({
    fn: async () => {
      const pending = storage.getPendingDeviceAuth();
      if (pending && !storage.isAuthenticated()) {
        const tokens = await authResource.pollDeviceAuth(pending.device_code);
        if (tokens) {
          storage.setAuth(tokens);
          storage.clearPendingDeviceAuth();
        }
      }

      const auth = storage.getAuth();
      if (auth) {
        return {
          authenticated: true as const,
          access_token: `${auth.access_token.substring(0, 20)}...`,
          token_type: auth.token_type,
          credentials_path: storage.getPath(),
          ...(update && { update }),
        };
      }

      const currentPending = storage.getPendingDeviceAuth();
      return {
        authenticated: false as const,
        credentials_path: storage.getPath(),
        ...(update && { update }),
        ...(currentPending
          ? {
              pending: true,
              verification_url: currentPending.verification_url,
              phrase: currentPending.phrase,
            }
          : {}),
      };
    },
    isTerminal: (status) => status.authenticated,
    interval: opts.interval,
    maxAttempts: opts.maxAttempts,
    timeout: opts.timeout,
  })) {
    yield result.value;
  }
}

export function createAuthCli(
  authResource: IAuthResource,
  getUpdateInfo?: UpdateInfoProvider,
  authStorage?: AuthStorage,
  envAccessToken?: string,
) {
  const storage = authStorage ?? defaultStorage;
  const cli = Cli.create('auth', {
    description: 'Authentication commands',
  });

  cli.command('login', {
    description: 'Authenticate with Link',
    options: loginOptions,
    outputPolicy: 'agent-only' as const,
    async *run(c) {
      const clientName = c.options.clientName?.trim();
      if (!clientName || clientName.length === 0) {
        return c.error({
          code: 'INVALID_INPUT',
          message: 'client-name must be a non-empty string',
        });
      }

      if (!c.agent && !c.formatExplicit) {
        return renderInteractive(
          <Login
            authResource={authResource}
            clientName={clientName}
            authStorage={storage}
            onComplete={() => {}}
          />,
          () => ({ authenticated: true, token_type: 'Bearer' }),
        );
      }

      const authRequest = await authResource.initiateDeviceAuth(clientName);
      storage.setPendingDeviceAuth({
        device_code: authRequest.device_code,
        interval: authRequest.interval,
        expires_at: Date.now() + authRequest.expires_in * 1000,
        verification_url: authRequest.verification_url_complete,
        phrase: authRequest.user_code,
      });

      const interval = c.options.interval;

      if (interval <= 0) {
        yield sanitizeDeep({
          verification_url: authRequest.verification_url_complete,
          phrase: authRequest.user_code,
          instruction:
            'Present the verification_url to the user and ask them to approve in the Link app. Then call `auth status --interval 5 --max-attempts 60` to poll until authenticated. Do not wait for the user to reply — start polling immediately.',
          _next: {
            command: 'auth status --interval 5 --max-attempts 60',
            poll_interval_seconds: authRequest.interval,
            until: 'authenticated is true',
          },
        });
        return;
      }

      yield sanitizeDeep({
        verification_url: authRequest.verification_url_complete,
        phrase: authRequest.user_code,
        instruction:
          'Present the verification_url to the user and ask them to approve in the Link app. Polling has started automatically — no further action needed.',
      });

      yield* pollAuthStatus(authResource, storage, {
        interval,
        maxAttempts: c.options.maxAttempts,
        timeout: c.options.timeout,
      });
    },
  });

  cli.command('logout', {
    description: 'Log out from Link',
    outputPolicy: 'agent-only' as const,
    async run(c) {
      const auth = storage.getAuth();
      if (auth?.refresh_token) {
        try {
          await authResource.revokeToken(auth.refresh_token);
        } catch {
          // best-effort: clear local storage regardless
        }
      }
      storage.clearAuth();
      storage.clearPendingDeviceAuth();
      storage.deleteConfig();
      const result = { authenticated: false };

      if (!c.agent && !c.formatExplicit) {
        return renderInteractive(
          <Logout
            authResource={authResource}
            authStorage={storage}
            onComplete={() => {}}
          />,
          () => result,
        );
      }

      return result;
    },
  });

  cli.command('status', {
    description: 'Check authentication status',
    options: statusOptions,
    outputPolicy: 'agent-only' as const,
    async *run(c) {
      const opts = c.options;
      const interval = opts.interval;
      const maxAttempts = opts.maxAttempts;
      const updateInfo = await getUpdateInfo?.({
        polling: interval > 0,
      });
      const update = updateInfo
        ? {
            current_version: updateInfo.current,
            latest_version: updateInfo.latest,
            update_command: 'npm install -g @stripe/link-cli',
          }
        : undefined;

      if (!c.agent && !c.formatExplicit) {
        return renderInteractive(
          <AuthStatus
            authStorage={storage}
            envAccessToken={envAccessToken}
            onComplete={() => {}}
          />,
          () => {
            const info = resolveAuthInfo(envAccessToken, storage);
            if (info.authenticated) {
              return {
                authenticated: true as const,
                access_token: info.tokenPreview,
                token_type: info.tokenType,
                ...(info.source === 'storage' && {
                  credentials_path: info.credentialsPath,
                }),
                ...(update && { update }),
              };
            }
            return {
              authenticated: false as const,
              credentials_path: info.credentialsPath,
              ...(update && { update }),
            };
          },
        );
      }

      if (envAccessToken) {
        yield {
          authenticated: true as const,
          access_token: `${envAccessToken.substring(0, 20)}...`,
          token_type: 'Bearer',
          ...(update && { update }),
        };
        return;
      }

      yield* pollAuthStatus(
        authResource,
        storage,
        {
          interval,
          maxAttempts,
          timeout: opts.timeout,
        },
        update,
      );
    },
  });

  return cli;
}
