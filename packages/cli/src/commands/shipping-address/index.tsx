import type { IShippingAddressResource } from '@stripe/link-sdk';
import { storage } from '@stripe/link-sdk';
import { Cli } from 'incur';
import { render } from 'ink';
import React from 'react';
import { ShippingAddressList } from './list';

export function createShippingAddressCli(
  createResource: () => IShippingAddressResource,
) {
  const cli = Cli.create('shipping-address', {
    description: 'Shipping address management commands',
  });

  cli.command('list', {
    description: 'List all shipping addresses on your account',
    outputPolicy: 'agent-only' as const,
    async run(c) {
      if (!storage.isAuthenticated()) {
        return c.error({
          code: 'NOT_AUTHENTICATED',
          message: 'Not authenticated. Run "link-cli auth login" first.',
          cta: {
            commands: [
              { command: 'auth login', description: 'Log in to Link' },
            ],
          },
        });
      }

      const resource = createResource();

      if (!c.agent && !c.formatExplicit) {
        return new Promise((resolve) => {
          const { waitUntilExit } = render(
            <ShippingAddressList resource={resource} onComplete={() => {}} />,
          );
          waitUntilExit().then(async () => {
            resolve(await resource.listShippingAddresses());
          });
        });
      }

      return resource.listShippingAddresses();
    },
  });

  return cli;
}
