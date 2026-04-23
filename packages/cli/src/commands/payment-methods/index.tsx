import type { IPaymentMethodsResource } from '@stripe/link-sdk';
import type { Command } from 'commander';
import React from 'react';
import { executeCommand, outputJson } from '../../utils/execute-command';
import { buildOutputHelp } from '../../utils/help-text';
import { requireAuth } from '../../utils/require-auth';
import { AddPaymentMethod, WALLET_URL } from './add';
import { PaymentMethodsList } from './list';
import { PAYMENT_METHOD_SCHEMA } from './schema';

export function registerPaymentMethodsCommands(
  program: Command,
  createResource: () => IPaymentMethodsResource,
): Command {
  const paymentMethodsCommand = program
    .command('payment-methods')
    .description('Payment methods management commands')
    .helpCommand(false);

  paymentMethodsCommand
    .command('list')
    .description('List all payment methods on your account')
    .option(
      '--output-json',
      'Output result as JSON instead of interactive display',
    )
    .addHelpText('after', buildOutputHelp(PAYMENT_METHOD_SCHEMA, true))
    .action(async (options: { outputJson?: boolean }) => {
      requireAuth();

      const resource = createResource();

      await executeCommand({
        outputJson: !!options.outputJson,
        jsonFn: async () => {
          return resource.listPaymentMethods();
        },
        renderFn: () => (
          <PaymentMethodsList resource={resource} onComplete={() => {}} />
        ),
      });
    });

  paymentMethodsCommand
    .command('add')
    .description('Open the Link wallet to add a new payment method')
    .option(
      '--output-json',
      'Output result as JSON instead of interactive display',
    )
    .action(async (options: { outputJson?: boolean }) => {
      requireAuth();

      if (options.outputJson) {
        outputJson({ url: WALLET_URL });
      } else {
        const { render } = await import('ink');
        const { waitUntilExit } = render(<AddPaymentMethod />);
        await waitUntilExit();
      }
    });

  return paymentMethodsCommand;
}
