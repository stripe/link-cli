import type { IUserInfoResource } from '@stripe/link-sdk';
import { storage } from '@stripe/link-sdk';
import { Cli } from 'incur';
import { render } from 'ink';
import React from 'react';
import { UserInfoRetrieve } from './retrieve';

export function createUserInfoCli(createResource: () => IUserInfoResource) {
  const cli = Cli.create('user-info', {
    description: 'User information commands',
  });

  cli.command('retrieve', {
    description: 'Retrieve user info (email, name, phone)',
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
            <UserInfoRetrieve resource={resource} onComplete={() => {}} />,
          );
          waitUntilExit().then(async () => {
            resolve(await resource.retrieve());
          });
        });
      }

      return resource.retrieve();
    },
  });

  return cli;
}
