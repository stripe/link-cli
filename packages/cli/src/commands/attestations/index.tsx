import type { IAttestationsResource } from '@stripe/link-sdk';
import { Cli } from 'incur';
import { renderInteractive } from '../../utils/render-interactive';
import { sanitizeDeep } from '../../utils/sanitize-text';
import { inspectionError } from '../identity/artifact-reader';
import { SavedArtifact } from '../identity/saved-artifact';
import { exportAttestationTokens } from './export';
import { listAttestations } from './inspect';
import { requestOptions } from './schema';
import {
  addAttestationsToPool,
  exportAttestationArtifact,
  takeAttestation,
  validateExportPath,
} from './storage';

export function createAttestationsCli(
  createResource: () => IAttestationsResource,
) {
  const cli = Cli.create('attestations', {
    description:
      'A privacy-preserving token that shows Link attests to your agent.',
  });

  cli.command('list', {
    description: 'List saved attestation files and stored token counts.',
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

  cli.command('take', {
    description: 'Remove and return one attestation token from the CLI pool.',
    mcp: false,
    outputPolicy: 'all' as const,
    async run(c) {
      try {
        return sanitizeDeep(await takeAttestation());
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
      const { count, outputFile: exportFile } = c.options;
      if (exportFile) await validateExportPath(exportFile);

      const artifact = exportAttestationTokens(
        await createResource().request({
          count,
        }),
      );
      const outputFile = exportFile
        ? await exportAttestationArtifact(artifact, exportFile)
        : await addAttestationsToPool(artifact);
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
            message={
              exportFile
                ? 'Attestation batch exported'
                : 'Attestation tokens added to pool'
            }
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
