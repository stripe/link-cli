import {
  type IIdentityCredentialsResource,
  LinkSdkError,
} from '@stripe/link-sdk';
import { Cli } from 'incur';
import { renderInteractive } from '../../utils/render-interactive';
import { inspectionError } from '../identity/artifact-reader';
import { SavedArtifact } from '../identity/saved-artifact';
import { listIdentityCredentials, showIdentityCredential } from './inspect';
import { issueIdentityCredential } from './issue';
import { writeIdentityCredentialArtifact } from './storage';

export function createIdentityCredentialsCli(
  createResource: () => IIdentityCredentialsResource,
) {
  const cli = Cli.create('credentials', {
    description: 'User info that has been signed, proving it comes from Link.',
  });

  cli.command('list', {
    description:
      'List metadata for the locally saved current credential, including expiry and key path. Does not contact Link or issue credentials.',
    mcp: false,
    outputPolicy: 'all' as const,
    async run() {
      return listIdentityCredentials();
    },
  });

  cli.command('show', {
    description:
      'Show the current saved credential path, expiry, holder-key path, and claim names. Does not print the credential, private key, or claim values.',
    mcp: false,
    outputPolicy: 'all' as const,
    async run(c) {
      try {
        return await showIdentityCredential();
      } catch (error) {
        return c.error(inspectionError(error));
      }
    },
  });

  cli.command('request', {
    description:
      'Request signed user info proving it comes from Link. Includes a wallet of claims such as name, email, and phone that you can present later.',
    mcp: false,
    outputPolicy: 'agent-only' as const,
    async run(c) {
      let result: Awaited<ReturnType<typeof issueIdentityCredential>>;
      let outputFile: string;
      try {
        result = await issueIdentityCredential({
          resource: createResource(),
        });
        outputFile = await writeIdentityCredentialArtifact(result);
      } catch (error) {
        if (error instanceof LinkSdkError) {
          throw error;
        }
        return c.error({
          code: 'INVALID_INPUT',
          message: (error as Error).message,
        });
      }

      if (
        c.agent ||
        c.formatExplicit ||
        process.argv.includes('--full-output')
      ) {
        return { ...result, output_file: outputFile };
      }

      const humanResult = {
        message: 'Identity credential saved',
        output_file: outputFile,
        expires_at: result.expires_at,
      };
      return renderInteractive(
        <SavedArtifact
          message={humanResult.message}
          outputFile={outputFile}
          details={[{ label: 'Expires', value: result.expires_at }]}
        />,
        () => humanResult,
      );
    },
  });

  return cli;
}
