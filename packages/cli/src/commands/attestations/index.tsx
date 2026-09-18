import type { IAttestationsResource } from '@stripe/link-sdk';
import { Cli } from 'incur';
import { renderInteractive } from '../../utils/render-interactive';
import { inspectionError } from '../identity/artifact-reader';
import { SavedArtifact } from '../identity/saved-artifact';
import { exportAttestationTokens } from './export';
import { listAttestations } from './inspect';
import { requestOptions } from './schema';
import { writeAttestationArtifact } from './storage';

export function createAttestationsCli(
  createResource: () => IAttestationsResource,
) {
  const cli = Cli.create('attestations', {
    description:
      'A privacy-preserving token that shows Link attests to your agent.',
  });

  cli.command('list', {
    description:
      'List saved attestation files and stored token counts. Does not contact Link or consume tokens; external usage is not tracked.',
    mcp: false,
    outputPolicy: 'all' as const,
    async run(c) {
      try {
        return await listAttestations();
      } catch (error) {
        return c.error(inspectionError(error));
      }
    },
  });

  cli.command('request', {
    description:
      'Get privacy-preserving tokens that show Link attests to your agent.',
    options: requestOptions,
    mcp: false,
    outputPolicy: 'agent-only' as const,
    async run(c) {
      const { count } = c.options;

      const artifact = exportAttestationTokens(
        await createResource().request({
          count,
        }),
      );
      const outputFile = await writeAttestationArtifact(artifact);
      const result = {
        issuer: artifact.issuer,
        token_key_id: artifact.token_key_id,
        count: artifact.count,
        output_file: outputFile,
      };

      if (
        !c.agent &&
        !c.formatExplicit &&
        !process.argv.includes('--full-output')
      ) {
        return renderInteractive(
          <SavedArtifact
            message={`Attestation token${artifact.count === 1 ? '' : 's'} saved`}
            outputFile={outputFile}
            details={[{ label: 'Count', value: artifact.count }]}
          />,
          () => result,
        );
      }

      return result;
    },
  });

  return cli;
}
