import type { IAttestationsResource } from '@stripe/link-sdk';
import { Cli } from 'incur';
import { createAttestationsCli } from '../attestations';

export function createIdentityCli(options: {
  createAttestationsResource: (accessToken?: string) => IAttestationsResource;
}) {
  const cli = Cli.create('identity', {
    description:
      'Privacy-preserving tokens that show Link attests to your agent.',
  });

  cli.command(createAttestationsCli(options.createAttestationsResource));
  return cli;
}
