import path from 'node:path';
import { sanitizeDeep } from '../../utils/sanitize-text';
import {
  ArtifactReadError,
  inspectionError,
  listArtifactFiles,
  readArtifact,
} from '../identity/artifact-reader';
import { savedCredentialSchema } from './schema';
import { getOutputDirectory } from './storage';

export async function showIdentityCredential() {
  const file = path.join(getOutputDirectory(), 'current.json');
  // Check the parent directory without creating or modifying it.
  await listArtifactFiles(getOutputDirectory());
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
    if (
      error instanceof ArtifactReadError &&
      error.code === 'ARTIFACT_NOT_FOUND'
    ) {
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
