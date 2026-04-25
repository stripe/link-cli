import { storage } from '@stripe/link-sdk';
import { Cli } from 'incur';
import { render } from 'ink';
import React from 'react';
import type { IAuthResource } from '../../auth/types';
import { Login } from './login';
import { Logout } from './logout';
import { loginOptions, statusOptions } from './schema';
import { AuthStatus } from './status';

export function createAuthCli(authResource: IAuthResource) {
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
        return new Promise((resolve) => {
          const { waitUntilExit } = render(
            <Login
              authResource={authResource}
              clientName={clientName}
              onComplete={() => {}}
            />,
          );
          waitUntilExit().then(() =>
            resolve({ authenticated: true, token_type: 'Bearer' }),
          );
        });
      }

      // Agent mode: initiate device auth, store pending state, return immediately.
      // The agent drives the polling loop via `auth status --interval`.
      const authRequest = await authResource.initiateDeviceAuth(clientName);
      storage.setPendingDeviceAuth({
        device_code: authRequest.device_code,
        interval: authRequest.interval,
        expires_at: Date.now() + authRequest.expires_in * 1000,
        verification_url: authRequest.verification_url_complete,
        passphrase: authRequest.user_code,
      });
      yield {
        verification_url: authRequest.verification_url_complete,
        passphrase: authRequest.user_code,
        instruction:
          'Present the verification_url to the user and ask them to approve in the Link app. Then call `auth status --interval 5 --max-attempts 60` to poll until authenticated. Do not wait for the user to reply — start polling immediately.',
        _next: {
          command: 'auth status --interval 5 --max-attempts 60',
          poll_interval_seconds: authRequest.interval,
          until: 'authenticated is true',
        },
      };
    },
  });

  cli.command('logout', {
    description: 'Log out from Link',
    outputPolicy: 'agent-only' as const,
    async run(c) {
      storage.clearAuth();
      storage.clearPendingDeviceAuth();
      storage.deleteConfig();
      const result = { authenticated: false };

      if (!c.agent && !c.formatExplicit) {
        return new Promise((resolve) => {
          const { waitUntilExit } = render(<Logout onComplete={() => {}} />);
          waitUntilExit().then(() => resolve(result));
        });
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
      const deadline = Date.now() + opts.timeout * 1000;
      let attempts = 0;

      while (true) {
        // If there's a pending device auth, try one poll to see if the user approved.
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
          yield {
            authenticated: true,
            access_token: `${auth.access_token.substring(0, 20)}...`,
            token_type: auth.token_type,
            credentials_path: storage.getPath(),
          };
          return;
        }

        const currentPending = storage.getPendingDeviceAuth();
        const status = {
          authenticated: false,
          credentials_path: storage.getPath(),
          ...(currentPending
            ? {
                pending: true,
                verification_url: currentPending.verification_url,
                passphrase: currentPending.passphrase,
              }
            : {}),
        };

        attempts++;
        const shouldStop =
          interval <= 0 ||
          (maxAttempts > 0 && attempts >= maxAttempts) ||
          Date.now() >= deadline;

        if (shouldStop) {
          yield status;
          return;
        }

        // Yield current status as MCP progress notification, then wait
        yield status;
        await new Promise((resolve) => setTimeout(resolve, interval * 1000));
      }
    },
  });

  return cli;
}
