import type {
  IPaymentMethodsResource,
  ISpendRequestResource,
} from '@stripe/link-sdk';
import type { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import { z } from 'zod';
import type { IAuthResource } from '../../auth/types';
import { registerSchemaOptions, resolveInput } from '../../utils/json-options';
import { DemoRunner } from './demo-runner';

const DEMO_INPUT_SCHEMA = {
  only_card: {
    schema: z.boolean(),
    flag: '--only-card',
    description: 'Run only the virtual card flow',
    defaultValue: false,
  },
  only_spt: {
    schema: z.boolean(),
    flag: '--only-spt',
    description: 'Run only the machine payment (SPT) flow',
    defaultValue: false,
  },
} as const;

export function registerDemoCommand(
  program: Command,
  authRepo: IAuthResource,
  spendRequestRepo: ISpendRequestResource,
  createPaymentMethodsResource: () => IPaymentMethodsResource,
): Command {
  const demoCommand = program
    .command('demo')
    .description(
      'Run an interactive demo of both Link payment flows (virtual card + machine payment)',
    );

  registerSchemaOptions(demoCommand, DEMO_INPUT_SCHEMA);

  demoCommand
    .option(
      '--json <json>',
      `JSON input (keys: ${Object.keys(DEMO_INPUT_SCHEMA).join(', ')})`,
    )
    .action(async (options) => {
      if (!process.stdout.isTTY) {
        process.stderr.write(
          'The demo command requires an interactive terminal.\n',
        );
        process.exit(1);
      }

      const resolved = resolveInput(options, DEMO_INPUT_SCHEMA);
      const paymentMethodsResource = createPaymentMethodsResource();

      const { waitUntilExit } = render(
        <DemoRunner
          authRepo={authRepo}
          spendRequestRepo={spendRequestRepo}
          paymentMethodsResource={paymentMethodsResource}
          onlyCard={!!resolved.only_card}
          onlySpt={!!resolved.only_spt}
          onComplete={() => process.exit(0)}
        />,
      );

      await waitUntilExit();
    });

  return demoCommand;
}
