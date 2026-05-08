import type { AuthStorage, IPaymentMethodsResource } from '@stripe/link-sdk';
import { Cli } from 'incur';
import { render } from 'ink';
import React from 'react';
import { requireAuth } from '../../utils/require-auth';
import { AddPaymentMethod, WALLET_URL } from './add';
import { PaymentMethodsList } from './list';

export function createPaymentMethodsCli(
  createResource: () => IPaymentMethodsResource,
  authStorage?: AuthStorage,
) {
  const cli = Cli.create('payment-methods', {
    description: 'Payment methods management commands',
  });

  cli.command('list', {
    description: 'List all payment methods on your account',
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage)],
    async run(c) {
      const resource = createResource();

      if (!c.agent && !c.formatExplicit) {
        return new Promise((resolve) => {
          const { waitUntilExit } = render(
            <PaymentMethodsList resource={resource} onComplete={() => {}} />,
          );
          waitUntilExit().then(async () => {
            resolve(await resource.listPaymentMethods());
          });
        });
      }

      return resource.listPaymentMethods();
    },
  });

  cli.command('add', {
    description: 'Open the Link wallet to add a new payment method',
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage)],
    async run(c) {
      if (!c.agent && !c.formatExplicit) {
        return new Promise((resolve) => {
          const { waitUntilExit } = render(<AddPaymentMethod />);
          waitUntilExit().then(() => resolve({ url: WALLET_URL }));
        });
      }

      return { url: WALLET_URL };
    },
  });

  return cli;
}
