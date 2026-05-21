import type {
  AuthStorage,
  IPaymentMethodsResource,
  ISpendRequestResource,
  IWebBotAuthResource,
} from '@stripe/link-sdk';
import { Cli } from 'incur';
import React from 'react';
import type { IAuthResource } from '../../auth/types';
import { renderInteractive } from '../../utils/render-interactive';
import { OnboardRunner } from './onboard-runner';

export function createOnboardCli(
  authRepo: IAuthResource,
  spendRequestRepo: ISpendRequestResource,
  createPaymentMethodsResource: () => IPaymentMethodsResource,
  createWebBotAuthResource: () => IWebBotAuthResource,
  authStorage?: AuthStorage,
) {
  return Cli.create('onboard', {
    description:
      'Guided setup: authenticate, verify payment methods, and demo both payment flows',
    outputPolicy: 'agent-only' as const,
    async run(c) {
      if (c.agent || c.formatExplicit) {
        return c.error({
          code: 'REQUIRES_TTY',
          message: 'The onboard command requires an interactive terminal.',
        });
      }

      const paymentMethodsResource = createPaymentMethodsResource();
      const webBotAuthResource = createWebBotAuthResource();

      return renderInteractive(
        <OnboardRunner
          authRepo={authRepo}
          spendRequestRepo={spendRequestRepo}
          paymentMethodsResource={paymentMethodsResource}
          webBotAuth={webBotAuthResource}
          authStorage={authStorage}
          onComplete={() => {}}
        />,
        () => ({}),
      );
    },
  });
}
