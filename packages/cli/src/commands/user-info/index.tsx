import type { AuthStorage, IUserInfoResource } from '@stripe/link-sdk';
import { Cli } from 'incur';
import React from 'react';
import { renderInteractive } from '../../utils/render-interactive';
import { requireAuth } from '../../utils/require-auth';
import { UserInfoRetrieve } from './retrieve';

export function createUserInfoCli(
  createResource: () => IUserInfoResource,
  authStorage?: AuthStorage,
  envAccessToken?: string,
) {
  const cli = Cli.create('user-info', {
    description: 'User information commands',
  });

  cli.command('retrieve', {
    description: 'Retrieve user info (email, name, phone)',
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage, envAccessToken)],
    async run(c) {
      const resource = createResource();

      if (!c.agent && !c.formatExplicit) {
        return renderInteractive(
          <UserInfoRetrieve resource={resource} onComplete={() => {}} />,
          () => resource.retrieve(),
        );
      }

      return resource.retrieve();
    },
  });

  return cli;
}
