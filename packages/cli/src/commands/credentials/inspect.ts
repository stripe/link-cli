import path from 'node:path';
import { z } from 'incur';
import { sanitizeDeep } from '../../utils/sanitize-text';
import { inspectionError, readArtifact } from '../identity/artifact-reader';
import { getOutputDirectory } from './storage';

// Inspect the saved metadata only; this is not credential verification.
const savedCredentialSchema = z.object({
  version: z.literal(1),
  credential: z.string().min(1),
  issuer: z.url(),
  expires_at: z.iso.datetime({ offset: true }),
  holder: z.object({
    path: z.string().min(1),
    thumbprint: z.string().min(1),
  }),
  claims: z.record(z.string(), z.unknown()).optional(),
});

export async function showIdentityCredential() {
  const file = path.join(getOutputDirectory(), 'current.json');
  const artifact = await readArtifact(file, savedCredentialSchema);
  return sanitizeDeep({
    output_file: file,
    issuer: artifact.issuer,
    expires_at: artifact.expires_at,
    expired: Date.parse(artifact.expires_at) <= Date.now(),
    holder: artifact.holder,
    claim_names: Object.keys(artifact.claims ?? {}).sort(),
  });
}

export async function listIdentityCredentials() {
  try {
    return { credentials: [await showIdentityCredential()], errors: [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { credentials: [], errors: [] };
    }
    return {
      credentials: [],
      errors: [
        sanitizeDeep({
          output_file: path.join(getOutputDirectory(), 'current.json'),
          ...inspectionError(error),
        }),
      ],
    };
  }
}
