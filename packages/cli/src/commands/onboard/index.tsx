import type {
  IPaymentMethodsResource,
  ISpendRequestResource,
} from '@stripe/link-sdk';
import { Cli } from 'incur';
import { render } from 'ink';
import React from 'react';
import type { IAuthResource } from '../../auth/types';
import { OnboardRunner } from './onboard-runner';

export function createOnboardCli(
  authRepo: IAuthResource,
  spendRequestRepo: ISpendRequestResource,
  createPaymentMethodsResource: () => IPaymentMethodsResource,
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

      return new Promise((resolve) => {
        const { waitUntilExit } = render(
          <OnboardRunner
            authRepo={authRepo}
            spendRequestRepo={spendRequestRepo}
            paymentMethodsResource={paymentMethodsResource}
            onComplete={() => {}}
          />,
        );
        waitUntilExit().then(() => resolve({}));
      });
    },
  });
}
