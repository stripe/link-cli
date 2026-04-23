import type { ISpendRequestResource } from '@stripe/link-sdk';
import type { Command } from 'commander';
import React from 'react';
import {
  executeCommand,
  outputError,
  outputErrors,
} from '../../utils/execute-command';
import { buildInputHelp, buildOutputHelp } from '../../utils/help-text';
import {
  ValidationError,
  registerSchemaOptions,
  resolveInput,
} from '../../utils/json-options';
import { requireAuth } from '../../utils/require-auth';
import { decodeStripeChallenge } from './decode';
import { DecodeChallengeView } from './decode-view';
import { MppPay, runMppPay } from './pay';
import {
  DECODE_INPUT_SCHEMA,
  DECODE_OUTPUT_SCHEMA,
  PAY_INPUT_SCHEMA,
  PAY_OUTPUT_SCHEMA,
} from './schema';

export function registerMppCommands(
  program: Command,
  repository: ISpendRequestResource,
): Command {
  const mppCommand = program
    .command('mpp')
    .description('Machine payment protocol (MPP) commands')
    .helpCommand(false);

  const payCmd = mppCommand
    .command('pay <url>')
    .description(
      'Complete a machine payment protocol (MPP) payment using an approved spend request',
    );

  registerSchemaOptions(payCmd, PAY_INPUT_SCHEMA);

  payCmd
    .option(
      '--json <json>',
      `JSON input (keys: ${Object.keys(PAY_INPUT_SCHEMA).join(', ')})`,
    )
    .option(
      '--output-json',
      'Output result as JSON instead of interactive display',
    )
    .addHelpText(
      'after',
      buildInputHelp(PAY_INPUT_SCHEMA) + buildOutputHelp(PAY_OUTPUT_SCHEMA),
    )
    .action(async (url: string, options) => {
      requireAuth();

      let resolved: Record<string, unknown> = {};
      try {
        resolved = resolveInput(options, PAY_INPUT_SCHEMA);
      } catch (err) {
        if (err instanceof ValidationError)
          process.stderr.write(`${err.errors.join('\n')}\n`);
        process.stderr.write(
          `${JSON.stringify({ error: (err as Error).message })}\n`,
        );
        process.exit(1);
      }

      const spendRequestId = resolved.spend_request_id as string;
      const method = resolved.method as string | undefined;
      const data = resolved.data as string | undefined;
      const headers = resolved.headers as string[] | undefined;

      await executeCommand({
        outputJson: !!options.outputJson,
        jsonFn: async () => {
          return runMppPay(
            url,
            spendRequestId,
            method,
            data,
            headers,
            repository,
          );
        },
        renderFn: () => (
          <MppPay
            url={url}
            spendRequestId={spendRequestId}
            method={method}
            data={data}
            headers={headers}
            repository={repository}
            onComplete={() => {}}
          />
        ),
      });
    });

  const decodeCmd = mppCommand
    .command('decode')
    .description(
      'Decode a stripe WWW-Authenticate challenge and extract network_id',
    );

  registerSchemaOptions(decodeCmd, DECODE_INPUT_SCHEMA);

  decodeCmd
    .option(
      '--json <json>',
      `JSON input (keys: ${Object.keys(DECODE_INPUT_SCHEMA).join(', ')})`,
    )
    .option(
      '--output-json',
      'Output result as JSON instead of interactive display',
    )
    .addHelpText(
      'after',
      buildInputHelp(DECODE_INPUT_SCHEMA) +
        buildOutputHelp(DECODE_OUTPUT_SCHEMA),
    )
    .action(async (options) => {
      let resolved: Record<string, unknown> = {};
      try {
        resolved = resolveInput(options, DECODE_INPUT_SCHEMA);
      } catch (err) {
        if (err instanceof ValidationError)
          outputErrors(err.errors, !!options.outputJson);
        outputError((err as Error).message);
      }

      const challenge = resolved.challenge as string;

      await executeCommand({
        outputJson: !!options.outputJson,
        jsonFn: async () => decodeStripeChallenge(challenge),
        renderFn: () => (
          <DecodeChallengeView decoded={decodeStripeChallenge(challenge)} />
        ),
      });
    });

  return mppCommand;
}
