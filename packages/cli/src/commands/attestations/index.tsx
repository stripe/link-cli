import type { IAttestationsResource } from '@stripe/link-sdk';
import { Cli } from 'incur';
import { exportAttestationTokens } from './export';
import { requestOptions } from './schema';
import { writeAttestationArtifact } from './storage';

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
      const { count, accessToken } = c.options;

      const artifact = exportAttestationTokens(
        await createResource(accessToken).request({
          count,
        }),
      );
      const outputFile = await writeAttestationArtifact(artifact);
      return {
        issuer: artifact.issuer,
        token_key_id: artifact.token_key_id,
        count: artifact.count,
        output_file: outputFile,
      };
    },
  });

  return cli;
}
