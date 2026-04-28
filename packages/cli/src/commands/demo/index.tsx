import type {
  IPaymentMethodsResource,
  ISpendRequestResource,
} from '@stripe/link-sdk';
import { Cli, z } from 'incur';
import { render } from 'ink';
import React from 'react';
import type { IAuthResource } from '../../auth/types';
import { DemoRunner } from './demo-runner';

const demoOptions = z.object({
  onlyCard: z
    .boolean()
    .default(false)
    .describe('Run only the virtual card flow'),
  onlySpt: z
    .boolean()
    .default(false)
    .describe('Run only the machine payment (SPT) flow'),
});

export function createDemoCli(
  authRepo: IAuthResource,
  spendRequestRepo: ISpendRequestResource,
  createPaymentMethodsResource: () => IPaymentMethodsResource,
) {
  return Cli.create('demo', {
    description:
      'Run an interactive demo of both Link payment flows (virtual card + machine payment)',
    options: demoOptions,
    outputPolicy: 'agent-only' as const,
    async run(c) {
      if (c.agent || c.formatExplicit) {
        return c.error({
          code: 'REQUIRES_TTY',
          message: 'The demo command requires an interactive terminal.',
        });
      }

      const paymentMethodsResource = createPaymentMethodsResource();

      return new Promise((resolve) => {
        const { waitUntilExit } = render(
          <DemoRunner
            authRepo={authRepo}
            spendRequestRepo={spendRequestRepo}
            paymentMethodsResource={paymentMethodsResource}
            onlyCard={c.options.onlyCard}
            onlySpt={c.options.onlySpt}
            onComplete={() => {}}
          />,
        );
        waitUntilExit().then(() => resolve({}));
      });
    },
  });
}
