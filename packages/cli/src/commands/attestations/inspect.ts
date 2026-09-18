import path from 'node:path';
import { sanitizeDeep } from '../../utils/sanitize-text';
import {
  ArtifactReadError,
  inspectionError,
  listArtifactFiles,
  readArtifact,
} from '../identity/artifact-reader';
import { savedAttestationSchema } from './schema';
import { getOutputDirectory } from './storage';

const usageNote =
  'Counts describe stored tokens. Usage outside the CLI is not tracked.';

async function inspectFile(file: string) {
  const artifact = await readArtifact(file, savedAttestationSchema);
  return sanitizeDeep({
    output_file: file,
    issuer: artifact.issuer,
    token_key_id: artifact.token_key_id,
    stored_token_count: artifact.tokens.length,
    usage: 'untracked' as const,
  });
}

export async function showAttestation(file: string) {
  const directory = getOutputDirectory();
  const outputFile = path.isAbsolute(file)
    ? path.resolve(file)
    : path.resolve(directory, file);
  if (path.dirname(outputFile) !== directory || !outputFile.endsWith('.json')) {
    throw new ArtifactReadError(
      'ARTIFACT_PATH_INVALID',
      'Use a JSON file path or filename from identity attestations list.',
    );
  }
  await listArtifactFiles(directory);
  return { ...(await inspectFile(outputFile)), note: usageNote };
}

export async function listAttestations() {
  const files = await listArtifactFiles(getOutputDirectory());
  const attestations: Awaited<ReturnType<typeof inspectFile>>[] = [];
  const errors: { output_file: string; code: string; message: string }[] = [];
  for (const file of files) {
    try {
      attestations.push(await inspectFile(file));
    } catch (error) {
      errors.push(
        sanitizeDeep({ output_file: file, ...inspectionError(error) }),
      );
    }
  }
  return {
    attestations,
    stored_token_count: attestations.reduce(
      (count, artifact) => count + artifact.stored_token_count,
      0,
    ),
    errors,
    note: usageNote,
  };
}
