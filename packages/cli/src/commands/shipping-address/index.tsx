import type { AuthStorage, IShippingAddressResource } from '@stripe/link-sdk';
import { Cli } from 'incur';
import React from 'react';
import { renderInteractive } from '../../utils/render-interactive';
import { requireAuth } from '../../utils/require-auth';
import { ShippingAddressList } from './list';

export function createShippingAddressCli(
  createResource: () => IShippingAddressResource,
  authStorage?: AuthStorage,
  envAccessToken?: string,
) {
  const cli = Cli.create('shipping-address', {
    description: 'Shipping address management commands',
  });

  cli.command('list', {
    description: 'List all shipping addresses on your account',
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage, envAccessToken)],
    async run(c) {
      const resource = createResource();

      if (!c.agent && !c.formatExplicit) {
        return renderInteractive(
          <ShippingAddressList resource={resource} onComplete={() => {}} />,
          () => resource.listShippingAddresses(),
        );
      }

      return resource.listShippingAddresses();
    },
  });

  return cli;
}
