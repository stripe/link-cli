import type {
  AuthStorage,
  IPaymentMethodsResource,
  ISpendRequestResource,
  IWebBotAuthResource,
} from '@stripe/link-sdk';
import { Cli, z } from 'incur';
import React from 'react';
import type { IAuthResource } from '../../auth/types';
import { renderInteractive } from '../../utils/render-interactive';
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
  createWebBotAuthResource: () => IWebBotAuthResource,
  authStorage?: AuthStorage,
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
      const webBotAuthResource = createWebBotAuthResource();

      return renderInteractive(
        <DemoRunner
          authRepo={authRepo}
          spendRequestRepo={spendRequestRepo}
          paymentMethodsResource={paymentMethodsResource}
          webBotAuth={webBotAuthResource}
          authStorage={authStorage}
          onlyCard={c.options.onlyCard}
          onlySpt={c.options.onlySpt}
          onComplete={() => {}}
        />,
        () => ({}),
      );
    },
  });
}
