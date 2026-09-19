import type {
  IAttestationsResource,
  IIdentityCredentialsResource,
} from '@stripe/link-sdk';
import { Cli } from 'incur';
import { createAttestationsCli } from '../attestations';
import { createIdentityCredentialsCli } from '../credentials';

export function createIdentityCli(options: {
  createAttestationsResource: () => IAttestationsResource;
  createIdentityCredentialsResource: () => IIdentityCredentialsResource;
}) {
  const cli = Cli.create('identity', {
    description: 'Prove your agent and user identity with Link.',
  });

  cli.command(createAttestationsCli(options.createAttestationsResource));
  cli.command(
    createIdentityCredentialsCli(options.createIdentityCredentialsResource),
  );
  return cli;
}
