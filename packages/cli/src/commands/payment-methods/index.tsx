import type { AuthStorage, IPaymentMethodsResource } from '@stripe/link-sdk';
import { Cli } from 'incur';
import React from 'react';
import { renderInteractive } from '../../utils/render-interactive';
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
        return renderInteractive(
          <PaymentMethodsList resource={resource} onComplete={() => {}} />,
          () => resource.listPaymentMethods(),
        );
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
        return renderInteractive(<AddPaymentMethod />, () => ({
          url: WALLET_URL,
        }));
      }

      return { url: WALLET_URL };
    },
  });

  return cli;
}
