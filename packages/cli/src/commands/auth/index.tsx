import {
  type AuthStorage,
  type SourceAction,
  storage as defaultStorage,
} from '@stripe/link-sdk';
import { Cli } from 'incur';
import { Text } from 'ink';
import React from 'react';
import {
  buildAuthorizationDetails,
  parseAuthorizationDetails,
} from '../../auth/authorization-details';
import { computeMergedAccess } from '../../auth/merge-access';
import { normalizeScopeInput } from '../../auth/scopes';
import type { IAuthResource, JsonValue } from '../../auth/types';
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

      // `auth upgrade` in progress: this device authorization replaces a
      // still-valid session, so complete it even though we're authenticated,
      // and do NOT report the old session as done until the new tokens land.
      // On success, swap in the new tokens and revoke the old grant.
      if (pending?.replaces_existing_session) {
        const previousRefreshToken = storage.getAuth()?.refresh_token;
        const tokens = await authResource.pollDeviceAuth(pending.device_code);
        if (tokens) {
          storage.setAuth(tokens);
          storage.clearPendingDeviceAuth();
          if (previousRefreshToken) {
            try {
              await authResource.revokeToken(previousRefreshToken);
            } catch {
              // best-effort: the widened session is already stored
            }
          }
          return {
            authenticated: true as const,
            access_token: `${tokens.access_token.substring(0, 20)}...`,
            token_type: tokens.token_type,
            credentials_path: storage.getPath(),
            ...(tokens.scope && { scope: tokens.scope }),
            ...(tokens.authorization_details && {
              authorization_details: tokens.authorization_details,
            }),
            ...(update && { update }),
          };
        }
        return {
          authenticated: false as const,
          credentials_path: storage.getPath(),
          ...(update && { update }),
          pending: true,
          verification_url: pending.verification_url,
          phrase: pending.phrase,
        };
      }

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
          ...(auth.scope && { scope: auth.scope }),
          ...(auth.authorization_details && {
            authorization_details: auth.authorization_details,
          }),
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

async function maybeRevokeAndClearAuth(
  authResource: IAuthResource,
  storage: AuthStorage,
) {
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
}

interface DeviceAuthParams {
  clientName?: string;
  scope?: string;
  sourceActions?: SourceAction[];
  authorizationDetails?: JsonValue[];
  // Marks the pending as replacing a still-valid session (see pollAuthStatus).
  replacesExistingSession?: boolean;
}

// Shared device-authorization tail for `login` and `upgrade`: initiate the
// device flow, persist the pending record, yield the verification code, and
// (when `--interval` polling is requested) poll inline until terminal. An
// optional `warning` is attached to the first yield for degraded-mode callers.
async function* startDeviceAuthAndPoll(
  authResource: IAuthResource,
  storage: AuthStorage,
  params: DeviceAuthParams,
  opts: PollAuthOptions,
  warning?: string,
) {
  const authRequest = await authResource.initiateDeviceAuth({
    clientName: params.clientName,
    scope: params.scope,
    sourceActions: params.sourceActions,
    authorizationDetails: params.authorizationDetails,
  });
  storage.setPendingDeviceAuth({
    device_code: authRequest.device_code,
    interval: authRequest.interval,
    expires_at: Date.now() + authRequest.expires_in * 1000,
    verification_url: authRequest.verification_url_complete,
    phrase: authRequest.user_code,
    ...(params.replacesExistingSession
      ? { replaces_existing_session: true }
      : {}),
  });

  const warningField = warning ? { warning } : {};

  if (opts.interval <= 0) {
    yield sanitizeDeep({
      ...warningField,
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
    ...warningField,
    verification_url: authRequest.verification_url_complete,
    phrase: authRequest.user_code,
    instruction:
      'Present the verification_url to the user and ask them to approve in the Link app. Polling has started automatically — no further action needed.',
  });

  yield* pollAuthStatus(authResource, storage, opts);
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
      const scope = normalizeScopeInput(c.options.scope);
      let authorizationDetails: JsonValue[] | undefined;
      if (!clientName || clientName.length === 0) {
        return c.error({
          code: 'INVALID_INPUT',
          message: 'client-name must be a non-empty string',
        });
      }
      if (c.options.scope !== undefined && !scope) {
        return c.error({
          code: 'INVALID_INPUT',
          message: 'scope must be a non-empty string when provided',
        });
      }
      try {
        authorizationDetails = parseAuthorizationDetails(
          c.options.authorizationDetail,
        );
      } catch (error) {
        return c.error({
          code: 'INVALID_INPUT',
          message: (error as Error).message,
        });
      }

      const existingAuth = storage.getAuth();
      if (existingAuth?.refresh_token) {
        try {
          const refreshed = await authResource.refreshToken(
            existingAuth.refresh_token,
          );
          storage.setAuth(refreshed);
          const alreadyLoggedInMessage =
            'You are already logged in. To switch accounts, run `link-cli auth logout` first.';
          const alreadyLoggedIn = sanitizeDeep({
            authenticated: true,
            message: alreadyLoggedInMessage,
          });
          if (!c.agent && !c.formatExplicit) {
            return renderInteractive(
              <Text color="yellow">{alreadyLoggedInMessage}</Text>,
              () => alreadyLoggedIn,
            );
          }
          yield alreadyLoggedIn;
          return;
        } catch {
          // Session not usable — fall through to full re-auth below
        }
      }

      await maybeRevokeAndClearAuth(authResource, storage);

      if (!c.agent && !c.formatExplicit) {
        return renderInteractive(
          <Login
            authResource={authResource}
            clientName={clientName}
            scope={scope}
            sourceActions={c.options.sourceActions}
            authorizationDetails={authorizationDetails}
            authStorage={storage}
            onComplete={() => {}}
          />,
          () => ({ authenticated: true, token_type: 'Bearer' }),
        );
      }

      yield* startDeviceAuthAndPoll(
        authResource,
        storage,
        {
          clientName,
          scope,
          sourceActions: c.options.sourceActions,
          authorizationDetails,
        },
        {
          interval: c.options.interval,
          maxAttempts: c.options.maxAttempts,
          timeout: c.options.timeout,
        },
      );
    },
  });

  cli.command('upgrade', {
    description:
      'Re-authenticate with Link, merging the requested access with your current access so the new session is a superset',
    options: loginOptions,
    outputPolicy: 'agent-only' as const,
    async *run(c) {
      const clientName = c.options.clientName?.trim();
      const requestedScope = normalizeScopeInput(c.options.scope);
      if (!clientName || clientName.length === 0) {
        return c.error({
          code: 'INVALID_INPUT',
          message: 'client-name must be a non-empty string',
        });
      }
      if (c.options.scope !== undefined && !requestedScope) {
        return c.error({
          code: 'INVALID_INPUT',
          message: 'scope must be a non-empty string when provided',
        });
      }

      let requestedAuthorizationDetails: JsonValue[];
      try {
        // Fold --source-actions into authorization details up front so `source`
        // merges like any other authorization-detail type below.
        requestedAuthorizationDetails = buildAuthorizationDetails(
          c.options.sourceActions,
          parseAuthorizationDetails(c.options.authorizationDetail),
        );
      } catch (error) {
        return c.error({
          code: 'INVALID_INPUT',
          message: (error as Error).message,
        });
      }

      // Start from exactly what was requested; if there's a usable session,
      // widen it to a superset of the current access.
      let scope = requestedScope;
      let authorizationDetails: JsonValue[] = requestedAuthorizationDetails;
      // Set when we have a live session to widen. The old grant is left intact
      // (not cleared, not revoked) until the new approval lands — see below.
      let previousRefreshToken: string | undefined;
      let warning: string | undefined;

      const existingAuth = storage.getAuth();
      if (existingAuth?.refresh_token) {
        try {
          const refreshed = await authResource.refreshToken(
            existingAuth.refresh_token,
          );
          // Persist the rotated tokens so the session stays valid throughout
          // the pending approval (and if initiateDeviceAuth below fails).
          storage.setAuth(refreshed);
          previousRefreshToken = refreshed.refresh_token;
          const merged = computeMergedAccess({
            requestedScope,
            requestedAuthorizationDetails,
            existingScope: refreshed.scope ?? existingAuth.scope,
            existingAuthorizationDetails:
              refreshed.authorization_details ??
              existingAuth.authorization_details,
          });
          scope = merged.mergedScope;
          authorizationDetails = merged.mergedAuthorizationDetails;
        } catch {
          // Existing token is no longer valid — warn and continue with only the
          // requested access (per spec, upgrade never hard-fails on this).
          // Clear the dead session so the poll isn't short-circuited by it.
          storage.clearAuth();
          storage.clearPendingDeviceAuth();
          warning =
            'could not refresh the existing session; continuing with only the requested access.';
          process.stderr.write(`warning: ${warning}\n`);
        }
      } else {
        warning =
          'no active session to upgrade; continuing with only the requested access.';
        process.stderr.write(`warning: ${warning}\n`);
      }

      // Unlike `login`, upgrade never bails when already authenticated. It does
      // NOT tear down the current session up front: the existing grant stays
      // valid (and un-revoked) throughout the pending approval, so a failed
      // initiate or an abandoned approval leaves it usable. The pending is
      // flagged `replaces_existing_session` so the poll completes the NEW
      // approval (rather than short-circuiting on the current token) and revokes
      // the old grant only once the widened tokens are stored.
      const replacesExistingSession = previousRefreshToken !== undefined;

      if (!c.agent && !c.formatExplicit) {
        return renderInteractive(
          <Login
            authResource={authResource}
            clientName={clientName}
            scope={scope}
            authorizationDetails={authorizationDetails}
            authStorage={storage}
            revokeRefreshTokenOnSuccess={previousRefreshToken}
            onComplete={() => {}}
          />,
          () => ({ authenticated: true, token_type: 'Bearer' }),
        );
      }

      yield* startDeviceAuthAndPoll(
        authResource,
        storage,
        { clientName, scope, authorizationDetails, replacesExistingSession },
        {
          interval: c.options.interval,
          maxAttempts: c.options.maxAttempts,
          timeout: c.options.timeout,
        },
        warning,
      );
    },
  });

  cli.command('logout', {
    description: 'Log out from Link',
    outputPolicy: 'agent-only' as const,
    async run(c) {
      await maybeRevokeAndClearAuth(authResource, storage);
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
                  ...(info.scope && { scope: info.scope }),
                  ...(info.authorizationDetails && {
                    authorization_details: info.authorizationDetails,
                  }),
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
