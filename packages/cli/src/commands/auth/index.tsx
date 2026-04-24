import { storage } from '@stripe/link-sdk';
import type { Command } from 'commander';
import React from 'react';
import type { IAuthResource } from '../../auth/types';
import {
  executeCommand,
  outputErrors,
  outputJson,
} from '../../utils/execute-command';
import { buildInputHelp, buildOutputHelp } from '../../utils/help-text';
import {
  ValidationError,
  registerSchemaOptions,
  resolveInput,
} from '../../utils/json-options';
import { Login } from './login';
import { Logout } from './logout';
import {
  AUTH_STATUS_SCHEMA,
  LOGIN_INPUT_SCHEMA,
  LOGIN_SCHEMA,
  LOGOUT_SCHEMA,
} from './schema';
import { AuthStatus } from './status';

export function registerAuthCommands(
  program: Command,
  authResource: IAuthResource,
): Command {
  const authCommand = program
    .command('auth')
    .description('Authentication commands')
    .helpCommand(false);

  const loginCmd = authCommand
    .command('login')
    .description('Authenticate with Link');

  registerSchemaOptions(loginCmd, LOGIN_INPUT_SCHEMA);

  loginCmd
    .option(
      '--json <json>',
      `JSON input (keys: ${Object.keys(LOGIN_INPUT_SCHEMA).join(', ')})`,
    )
    .option(
      '--output-json',
      'Output result as JSON instead of interactive display',
    )
    .addHelpText(
      'after',
      buildInputHelp(LOGIN_INPUT_SCHEMA) + buildOutputHelp(LOGIN_SCHEMA),
    )
    .action(async (options: Record<string, unknown>) => {
      let input: Record<string, unknown> = {};
      try {
        input = resolveInput(options, LOGIN_INPUT_SCHEMA);
      } catch (err) {
        if (err instanceof ValidationError) {
          outputErrors(err.errors, !!options.outputJson);
          process.exit(1);
        }
        throw err;
      }

      const clientName = input.client_name as string;

      await executeCommand({
        outputJson: !!options.outputJson,
        jsonFn: async () => {
          const authRequest = await authResource.initiateDeviceAuth(clientName);
          outputJson({
            verification_url: authRequest.verification_url_complete,
            passphrase: authRequest.user_code,
          });

          const pollInterval = authRequest.interval * 1000;
          const expiresAt = Date.now() + authRequest.expires_in * 1000;
          const startTime = Date.now();

          while (Date.now() < expiresAt) {
            await new Promise((resolve) => setTimeout(resolve, pollInterval));
            const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
            process.stderr.write(
              `${JSON.stringify({
                type: 'waiting',
                command: 'auth_login',
                elapsed_seconds: elapsedSeconds,
                verification_url: authRequest.verification_url_complete,
                passphrase: authRequest.user_code,
              })}\n`,
            );
            const tokens = await authResource.pollDeviceAuth(
              authRequest.device_code,
            );
            if (tokens) {
              storage.setAuth(tokens);
              return { authenticated: true, token_type: tokens.token_type };
            }
          }
          throw new Error('Device authorization timed out');
        },
        renderFn: () => (
          <Login
            authResource={authResource}
            clientName={clientName}
            onComplete={() => {}}
          />
        ),
      });
    });

  authCommand
    .command('logout')
    .description('Log out from Link')
    .option(
      '--output-json',
      'Output result as JSON instead of interactive display',
    )
    .addHelpText('after', buildOutputHelp(LOGOUT_SCHEMA))
    .action(async (options: { outputJson?: boolean }) => {
      await executeCommand({
        outputJson: !!options.outputJson,
        jsonFn: async () => {
          const auth = storage.getAuth();
          if (auth?.refresh_token) {
            try {
              await authResource.revokeToken(auth.refresh_token);
            } catch {
              // best-effort: clear local storage regardless
            }
          }
          storage.clearAuth();
          storage.deleteConfig();
          return { authenticated: false };
        },
        renderFn: () => (
          <Logout authResource={authResource} onComplete={() => {}} />
        ),
      });
    });

  authCommand
    .command('status')
    .description('Check authentication status')
    .option(
      '--output-json',
      'Output result as JSON instead of interactive display',
    )
    .addHelpText('after', buildOutputHelp(AUTH_STATUS_SCHEMA))
    .action(async (options: { outputJson?: boolean }) => {
      await executeCommand({
        outputJson: !!options.outputJson,
        jsonFn: async () => {
          const auth = storage.getAuth();
          if (auth) {
            return {
              authenticated: true,
              access_token: `${auth.access_token.substring(0, 20)}...`,
              token_type: auth.token_type,
              credentials_path: storage.getPath(),
            };
          }
          return { authenticated: false, credentials_path: storage.getPath() };
        },
        renderFn: () => <AuthStatus onComplete={() => {}} />,
      });
    });

  return authCommand;
}
