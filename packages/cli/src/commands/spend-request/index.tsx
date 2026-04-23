import type {
  CredentialType,
  ISpendRequestResource,
  LineItem,
  Total,
} from '@stripe/link-sdk';
import type { Command } from 'commander';
import React from 'react';
import {
  executeCommand,
  outputError,
  outputErrors,
  outputJson,
} from '../../utils/execute-command';
import { buildInputHelp, buildOutputHelp } from '../../utils/help-text';
import {
  ValidationError,
  registerSchemaOptions,
  resolveInput,
} from '../../utils/json-options';
import { pollUntilApproved } from '../../utils/poll-until-approved';
import { requireAuth } from '../../utils/require-auth';
import { CreateSpendRequest } from './create';
import { RequestApproval } from './request-approval';
import { RetrieveSpendRequest } from './retrieve';
import {
  CREATE_INPUT_SCHEMA,
  RETRIEVE_INPUT_SCHEMA,
  SPEND_REQUEST_OUTPUT_SCHEMA,
  UPDATE_INPUT_SCHEMA,
} from './schema';
import { UpdateSpendRequest } from './update';

export function registerSpendRequestCommands(
  program: Command,
  repository: ISpendRequestResource,
): Command {
  const spendRequestCommand = program
    .command('spend-request')
    .description('Spend request management commands')
    .helpCommand(false);

  const createCmd = spendRequestCommand
    .command('create')
    .description('Create a new spend request');

  registerSchemaOptions(createCmd, CREATE_INPUT_SCHEMA);

  createCmd
    .option(
      '--json <json>',
      `JSON input (keys: ${Object.keys(CREATE_INPUT_SCHEMA).join(', ')})`,
    )
    .option(
      '--output-json',
      'Output result as JSON instead of interactive display',
    )
    .addHelpText(
      'after',
      buildInputHelp(CREATE_INPUT_SCHEMA) +
        buildOutputHelp(SPEND_REQUEST_OUTPUT_SCHEMA),
    )
    .action(async (options) => {
      requireAuth();

      let resolved: Record<string, unknown> = {};
      try {
        resolved = resolveInput(options, CREATE_INPUT_SCHEMA);
      } catch (err) {
        if (err instanceof ValidationError)
          outputErrors(err.errors, !!options.outputJson);
        outputError((err as Error).message);
      }

      const requestApproval = !!resolved.request_approval;

      const credentialType = resolved.credential_type as
        | CredentialType
        | undefined;
      const networkId = resolved.network_id as string | undefined;

      if (credentialType === 'shared_payment_token' && !networkId) {
        outputError(
          'network-id is required when credential-type is shared_payment_token',
        );
      }
      if (networkId && credentialType !== 'shared_payment_token') {
        outputError(
          'network-id can only be used when credential-type is shared_payment_token',
        );
      }
      if (
        credentialType !== 'shared_payment_token' &&
        !resolved.merchant_name
      ) {
        outputError('merchant-name is required when credential-type is card');
      }
      if (credentialType !== 'shared_payment_token' && !resolved.merchant_url) {
        outputError('merchant-url is required when credential-type is card');
      }

      const createParams = {
        payment_details: resolved.payment_method_id as string,
        credential_type: credentialType,
        network_id: networkId,
        amount: resolved.amount as number | undefined,
        currency: resolved.currency as string | undefined,
        merchant_name: resolved.merchant_name as string | undefined,
        merchant_url: resolved.merchant_url as string | undefined,
        context: resolved.context as string,
        line_items: resolved.line_items as LineItem[] | undefined,
        totals: resolved.totals as Total[] | undefined,
        request_approval: requestApproval || undefined,
        test: resolved.test ? true : undefined,
      };

      await executeCommand({
        outputJson: !!options.outputJson,
        jsonFn: async () => {
          const created = await repository.createSpendRequest(createParams);
          if (requestApproval) {
            outputJson(created);
            return pollUntilApproved(repository, created.id, {
              onProgress: (elapsedSeconds) => {
                process.stderr.write(
                  `${JSON.stringify({
                    type: 'waiting',
                    command: 'spend_request_approval',
                    elapsed_seconds: elapsedSeconds,
                    approval_url: created.approval_url ?? null,
                    spend_request_id: created.id,
                  })}\n`,
                );
              },
            });
          }
          return created;
        },
        renderFn: () => (
          <CreateSpendRequest
            repository={repository}
            params={createParams}
            requestApproval={requestApproval}
            onComplete={() => {}}
          />
        ),
      });
    });

  const updateCmd = spendRequestCommand
    .command('update <id>')
    .description('Update a spend request');

  registerSchemaOptions(updateCmd, UPDATE_INPUT_SCHEMA);

  updateCmd
    .option(
      '--json <json>',
      `JSON input (keys: ${Object.keys(UPDATE_INPUT_SCHEMA).join(', ')})`,
    )
    .option(
      '--output-json',
      'Output result as JSON instead of interactive display',
    )
    .addHelpText(
      'after',
      buildInputHelp(UPDATE_INPUT_SCHEMA) +
        buildOutputHelp(SPEND_REQUEST_OUTPUT_SCHEMA),
    )
    .action(async (id: string, options) => {
      requireAuth();

      let resolved: Record<string, unknown> = {};
      try {
        resolved = resolveInput(options, UPDATE_INPUT_SCHEMA);
      } catch (err) {
        if (err instanceof ValidationError)
          outputErrors(err.errors, !!options.outputJson);
        outputError((err as Error).message);
      }

      const params: Record<string, unknown> = {};
      if (resolved.payment_method_id !== undefined)
        params.payment_details = resolved.payment_method_id;
      if (resolved.amount !== undefined) params.amount = resolved.amount;
      if (resolved.merchant_url !== undefined)
        params.merchant_url = resolved.merchant_url;
      if (resolved.profile_id !== undefined)
        params.profile_id = resolved.profile_id;
      if (resolved.merchant_id !== undefined)
        params.merchant_id = resolved.merchant_id;
      if (resolved.currency !== undefined) params.currency = resolved.currency;
      if (resolved.line_items !== undefined)
        params.line_items = resolved.line_items;
      if (resolved.totals !== undefined) params.totals = resolved.totals;

      await executeCommand({
        outputJson: !!options.outputJson,
        jsonFn: async () => {
          return repository.updateSpendRequest(id, params);
        },
        renderFn: () => (
          <UpdateSpendRequest
            repository={repository}
            id={id}
            params={params}
            onComplete={() => {}}
          />
        ),
      });
    });

  spendRequestCommand
    .command('request-approval <id>')
    .description('Request approval for a spend request')
    .option(
      '--output-json',
      'Output result as JSON instead of interactive display',
    )
    .addHelpText('after', buildOutputHelp(SPEND_REQUEST_OUTPUT_SCHEMA))
    .action(async (id: string, options: { outputJson?: boolean }) => {
      requireAuth();

      await executeCommand({
        outputJson: !!options.outputJson,
        jsonFn: async () => {
          const approval = await repository.requestApproval(id);
          outputJson(approval);
          return pollUntilApproved(repository, id, {
            onProgress: (elapsedSeconds) => {
              process.stderr.write(
                `${JSON.stringify({
                  type: 'waiting',
                  command: 'spend_request_approval',
                  elapsed_seconds: elapsedSeconds,
                  approval_url: approval.approval_link ?? null,
                  spend_request_id: id,
                })}\n`,
              );
            },
          });
        },
        renderFn: () => (
          <RequestApproval
            repository={repository}
            id={id}
            onComplete={() => {}}
          />
        ),
      });
    });

  const retrieveCmd = spendRequestCommand
    .command('retrieve <id>')
    .description('Retrieve a spend request');

  registerSchemaOptions(retrieveCmd, RETRIEVE_INPUT_SCHEMA);

  retrieveCmd
    .option(
      '--json <json>',
      `JSON input (keys: ${Object.keys(RETRIEVE_INPUT_SCHEMA).join(', ')})`,
    )
    .option(
      '--output-json',
      'Output result as JSON instead of interactive display',
    )
    .addHelpText(
      'after',
      buildInputHelp(RETRIEVE_INPUT_SCHEMA) +
        buildOutputHelp(SPEND_REQUEST_OUTPUT_SCHEMA),
    )
    .action(async (id: string, options) => {
      requireAuth();

      let resolved: Record<string, unknown> = {};
      try {
        resolved = resolveInput(options, RETRIEVE_INPUT_SCHEMA);
      } catch (err) {
        if (err instanceof ValidationError)
          outputErrors(err.errors, !!options.outputJson);
        outputError((err as Error).message);
      }

      const timeout = resolved.timeout as number;
      const includeArr = resolved.include as string[] | undefined;
      const include = includeArr?.length ? includeArr : undefined;

      await executeCommand({
        outputJson: !!options.outputJson,
        jsonFn: async () => {
          const request = await repository.getSpendRequest(id, { include });
          if (!request) {
            throw new Error(`Spend request ${id} not found`);
          }
          return request;
        },
        renderFn: () => (
          <RetrieveSpendRequest
            repository={repository}
            id={id}
            timeout={timeout}
            include={include}
            onComplete={() => {}}
          />
        ),
      });
    });

  return spendRequestCommand;
}
