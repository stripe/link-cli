import type { IAttestationsResource } from '@stripe/link-sdk';
import { Cli } from 'incur';
import { writeCredentialFile } from '../../utils/credential-output';
import { exportAttestationTokens } from './export';
import { requestOptions } from './schema';

export function createAttestationsCli(
  createResource: (accessToken?: string) => IAttestationsResource,
) {
  const cli = Cli.create('attestations', {
    description:
      'A privacy-preserving token that shows Link attests to your agent.',
  });

  cli.command('request', {
    description:
      'Get privacy-preserving tokens that show Link attests to your agent.',
    options: requestOptions,
    mcp: false,
    outputPolicy: 'agent-only' as const,
    async run(c) {
      const { count, accessToken, outputFile, force } = c.options;

      const result = exportAttestationTokens(
        await createResource(accessToken).request({
          count,
        }),
      );
      if (outputFile) {
        await writeCredentialFile(outputFile, result, force);
      }
      return result;
    },
  });

  return cli;
}
