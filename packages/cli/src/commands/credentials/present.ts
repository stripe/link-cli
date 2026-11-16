import path from 'node:path';
import { createPresentation } from '@stripe/link-sdk/presentation';
import { z } from 'incur';
import { readArtifact } from '../identity/artifact-reader';
import { loadHolderKey } from './holder-key';
import { presentOptions } from './schema';
import { getOutputDirectory } from './storage';

const artifactSchema = z.object({
  version: z.literal(1),
  credential: z.string().min(1),
  holder: z.object({ path: z.string().min(1) }),
});

export async function presentIdentityCredential(
  input: z.infer<typeof presentOptions>,
) {
  const options = presentOptions.parse(input);
  const file = path.join(getOutputDirectory(), 'current.json');
  let artifact: z.infer<typeof artifactSchema>;
  try {
    artifact = await readArtifact(file, artifactSchema);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        'No saved identity credential. Run identity credentials request first.',
      );
    }
    throw error;
  }

  const presentation = await createPresentation({
    credential: artifact.credential,
    aud: options.aud,
    nonce: options.nonce,
    disclose: options.claim,
    // The SDK validates the credential and requested claims before calling this.
    // Keep the CLI's existing no-replacement and symlink-safe key loading policy.
    holderKey: () => {
      try {
        return loadHolderKey(artifact.holder.path).privateKey.export({
          format: 'jwk',
        }) as JsonWebKey;
      } catch (error) {
        throw new Error(
          'Unable to load the saved holder key. It must exist, contain a valid private JWK, and not be a symbolic link.',
          { cause: error },
        );
      }
    },
  });
  return { presentation };
}
