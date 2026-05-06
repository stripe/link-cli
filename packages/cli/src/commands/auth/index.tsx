import { type AuthStorage, storage as defaultStorage } from '@stripe/link-sdk';
import { Cli } from 'incur';
import React from 'react';
import type { IAuthResource } from '../../auth/types';
import { pollUntil } from '../../utils/poll-until';
import { renderInteractive } from '../../utils/render-interactive';
import type { UpdateInfoProvider } from '../../utils/update-info';
import { Login } from './login';
import { Logout } from './logout';
import { loginOptions, statusOptions } from './schema';
import { AuthStatus } from './status';

export function createAuthCli(
  authResource: IAuthResource,
  getUpdateInfo?: UpdateInfoProvider,
  authStorage?: AuthStorage,
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

      // Agent mode: initiate device auth, store pending state, yield code immediately.
      const authRequest = await authResource.initiateDeviceAuth(clientName);
      storage.setPendingDeviceAuth({
        device_code: authRequest.device_code,
        interval: authRequest.interval,
        expires_at: Date.now() + authRequest.expires_in * 1000,
        verification_url: authRequest.verification_url_complete,
        phrase: authRequest.user_code,
      });

      const interval = c.options.interval;
      const maxAttempts = c.options.maxAttempts;

      if (interval <= 0) {
        // No polling requested: return code with _next hint (original behavior).
        yield {
          verification_url: authRequest.verification_url_complete,
          phrase: authRequest.user_code,
          instruction:
            'Present the verification_url to the user and ask them to approve in the Link app. Then call `auth status --interval 5 --max-attempts 60` to poll until authenticated. Do not wait for the user to reply — start polling immediately.',
          _next: {
            command: 'auth status --interval 5 --max-attempts 60',
            poll_interval_seconds: authRequest.interval,
            until: 'authenticated is true',
          },
        };
        return;
      }

      // Inline polling: emit code to stderr (visible immediately even while
      // stdout is buffered), then yield it as structured output for MCP streaming.
      process.stderr.write(
        `\nVerification URL: ${authRequest.verification_url_complete}\nPhrase: ${authRequest.user_code}\n\nOpen the URL, log in to Link, and enter the phrase to approve.\nPolling for approval...\n\n`,
      );
      yield {
        verification_url: authRequest.verification_url_complete,
        phrase: authRequest.user_code,
        instruction:
          'Present the verification_url to the user and ask them to approve in the Link app. Polling has started automatically — no further action needed.',
      };

      const deadline = Date.now() + c.options.timeout * 1000;
      let attempts = 0;

      while (true) {
        await new Promise((resolve) => setTimeout(resolve, interval * 1000));

        const pending = storage.getPendingDeviceAuth();
        if (!pending) {
          return c.error({
            code: 'AUTH_EXPIRED',
            message:
              'Device authorization expired. Please run auth login again.',
          });
        }

        try {
          const tokens = await authResource.pollDeviceAuth(pending.device_code);
          if (tokens) {
            storage.setAuth(tokens);
            storage.clearPendingDeviceAuth();
            yield {
              authenticated: true,
              token_type: tokens.token_type,
              credentials_path: storage.getPath(),
            };
            return;
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return c.error({ code: 'AUTH_FAILED', message });
        }

        attempts++;
        const shouldStop =
          (maxAttempts > 0 && attempts >= maxAttempts) ||
          Date.now() >= deadline;

        if (shouldStop) {
          return c.error({
            code: 'POLLING_TIMEOUT',
            message:
              'Timed out waiting for user approval. The verification code may have expired — run auth login again to get a new one.',
          });
        }
      }
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
          <AuthStatus authStorage={storage} onComplete={() => {}} />,
          () => {
            const auth = storage.getAuth();
            return {
              authenticated: !!auth,
              ...(auth
                ? {
                    access_token: `${auth.access_token.substring(0, 20)}...`,
                    token_type: auth.token_type,
                  }
                : {}),
              credentials_path: storage.getPath(),
              ...(update && { update }),
            };
          },
        );
      }

      for await (const result of pollUntil({
        fn: async () => {
          // If there's a pending device auth, try one poll to see if the user approved.
          const pending = storage.getPendingDeviceAuth();
          if (pending && !storage.isAuthenticated()) {
            const tokens = await authResource.pollDeviceAuth(
              pending.device_code,
            );
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
        interval,
        maxAttempts,
        timeout: opts.timeout,
      })) {
        yield result.value;
      }
    },
  });

  return cli;
}
