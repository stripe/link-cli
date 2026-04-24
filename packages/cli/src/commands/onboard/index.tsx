import type {
  IPaymentMethodsResource,
  ISpendRequestResource,
} from '@stripe/link-sdk';
import type { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import type { IAuthResource } from '../../auth/types';
import { OnboardRunner } from './onboard-runner';

export function registerOnboardCommand(
  program: Command,
  authRepo: IAuthResource,
  spendRequestRepo: ISpendRequestResource,
  createPaymentMethodsResource: () => IPaymentMethodsResource,
): Command {
  const onboardCommand = program
    .command('onboard')
    .description(
      'Guided setup: authenticate, verify payment methods, and demo both payment flows',
    )
    .action(async () => {
      if (!process.stdout.isTTY) {
        process.stderr.write(
          'The onboard command requires an interactive terminal.\n',
        );
        process.exit(1);
      }

      const paymentMethodsResource = createPaymentMethodsResource();

      const { waitUntilExit } = render(
        <OnboardRunner
          authRepo={authRepo}
          spendRequestRepo={spendRequestRepo}
          paymentMethodsResource={paymentMethodsResource}
          onComplete={() => process.exit(0)}
        />,
      );

      await waitUntilExit();
    });

  return onboardCommand;
}
