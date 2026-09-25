import type { IPaymentMethodsResource, PaymentMethod } from '@stripe/link-sdk';
import { Cli } from 'incur';
import type { CliAuthStorage } from '../../auth/storage';
import { renderInteractive } from '../../utils/render-interactive';
import { requireAuth } from '../../utils/require-auth';
import { AddPaymentMethod, WALLET_URL } from './add';
import { PaymentMethodsList } from './list';
import { PaymentMethodRetrieve } from './retrieve';
import { retrieveArgs, updateArgs, updateOptions } from './schema';
import { PaymentMethodUpdate } from './update';

export function createPaymentMethodsCli(
  createResource: () => IPaymentMethodsResource,
  authStorage?: CliAuthStorage,
  envAccessToken?: string,
) {
  const cli = Cli.create('payment-methods', {
    description: 'Payment methods management commands',
  });

  cli.command('list', {
    description: 'List all payment methods on your account',
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage, envAccessToken)],
    async run(c) {
      const resource = createResource();

      if (!c.agent && !c.formatExplicit) {
        return renderInteractive(
          <PaymentMethodsList resource={resource} onComplete={() => {}} />,
          () => resource.list(),
        );
      }

      return resource.list();
    },
  });

  cli.command('retrieve', {
    description: 'Retrieve a payment method by ID',
    args: retrieveArgs,
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage, envAccessToken)],
    async run(c) {
      const resource = createResource();
      const id = c.args.id;

      if (!c.agent && !c.formatExplicit) {
        return renderInteractive(
          <PaymentMethodRetrieve
            resource={resource}
            id={id}
            onComplete={() => {}}
          />,
          async () => {
            const paymentMethod = await resource.retrieve(id);
            if (!paymentMethod) {
              throw new Error(`Payment method ${id} not found`);
            }
            return paymentMethod;
          },
        );
      }

      const paymentMethod = await resource.retrieve(id);
      if (!paymentMethod) {
        return c.error({
          code: 'NOT_FOUND',
          message: `Payment method ${id} not found`,
        });
      }
      return paymentMethod;
    },
  });

  cli.command('update', {
    description: 'Update a payment method nickname',
    args: updateArgs,
    options: updateOptions,
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage, envAccessToken)],
    async run(c) {
      const resource = createResource();
      const id = c.args.id;
      const nickname = c.options.nickname;

      if (!c.agent && !c.formatExplicit) {
        let capturedResult: PaymentMethod | undefined;
        return renderInteractive(
          <PaymentMethodUpdate
            resource={resource}
            id={id}
            nickname={nickname}
            onComplete={(result) => {
              capturedResult = result;
            }}
          />,
          () => {
            if (capturedResult === undefined) {
              throw new Error('Component exited without producing a result');
            }
            return capturedResult;
          },
        );
      }

      return resource.update(id, { nickname });
    },
  });

  cli.command('add', {
    description: 'Open the Link wallet to add a new payment method',
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage, envAccessToken)],
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
