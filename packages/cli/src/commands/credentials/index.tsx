import {
  type IIdentityCredentialsResource,
  LinkSdkError,
} from '@stripe/link-sdk';
import { Cli } from 'incur';
import { renderInteractive } from '../../utils/render-interactive';
import { sanitizeDeep } from '../../utils/sanitize-text';
import { SavedArtifact } from '../identity/saved-artifact';
import { issueIdentityCredential } from './issue';
import { listIdentityCredentials } from './list';
import { writeIdentityCredentialArtifact } from './storage';

export function createIdentityCredentialsCli(
  createResource: () => IIdentityCredentialsResource,
) {
  const cli = Cli.create('credentials', {
    description: 'User info that has been signed, proving it comes from Link.',
  });

  cli.command('list', {
    description:
      'List metadata for the locally saved current credential, including expiry and key path.',
    mcp: false,
    outputPolicy: 'all' as const,
    async run() {
      return listIdentityCredentials();
    },
  });

  cli.command('request', {
    description:
      'Save signed user info proving it comes from Link and return its path and metadata. The saved credential includes claims such as name, email, and phone that you can present later.',
    mcp: false,
    outputPolicy: 'agent-only' as const,
    async run(c) {
      let artifact: Awaited<ReturnType<typeof issueIdentityCredential>>;
      let outputFile: string;
      try {
        artifact = await issueIdentityCredential({
          resource: createResource(),
        });
        outputFile = await writeIdentityCredentialArtifact(artifact);
      } catch (error) {
        if (error instanceof LinkSdkError) {
          throw error;
        }
        return c.error({
          code: 'INVALID_INPUT',
          message: (error as Error).message,
        });
      }

      const result = sanitizeDeep({
        issuer: artifact.issuer,
        expires_at: artifact.expires_at,
        holder: {
          path: artifact.holder.path,
          thumbprint: artifact.holder.thumbprint,
        },
        claim_names: Object.keys(artifact.claims ?? {}).sort(),
        output_file: outputFile,
      });

      if (
        !c.agent &&
        !c.formatExplicit &&
        !process.argv.includes('--full-output')
      ) {
        return renderInteractive(
          <SavedArtifact
            message="Identity credential saved"
            outputFile={outputFile}
            details={[{ label: 'Expires', value: result.expires_at }]}
          />,
          () => result,
        );
      }

      return result;
    },
  });

  return cli;
}
