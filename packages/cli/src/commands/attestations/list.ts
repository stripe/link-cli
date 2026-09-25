import { sanitizeDeep } from '../../utils/sanitize-text';
import {
  inspectionError,
  listArtifactFiles,
  readArtifact,
} from '../identity/artifact-reader';
import { savedAttestationSchema } from './export';
import {
  getOutputDirectory,
  getPoolPath,
  readAttestationPool,
} from './storage';

async function inspectFile(file: string) {
  const managed = file === getPoolPath();
  const artifacts = managed
    ? (await readAttestationPool()).batches
    : [await readArtifact(file, savedAttestationSchema)];
  return artifacts.map((artifact) =>
    sanitizeDeep({
      output_file: file,
      storage: managed ? ('pool' as const) : ('export' as const),
      issuer: artifact.issuer,
      token_key_id: artifact.token_key_id,
      stored_token_count: artifact.tokens.length,
    }),
  );
}

export async function listAttestations() {
  const files = await listArtifactFiles(getOutputDirectory());
  const attestations: Awaited<ReturnType<typeof inspectFile>> = [];
  const errors: { output_file: string; code: string; message: string }[] = [];
  for (const file of files) {
    try {
      attestations.push(...(await inspectFile(file)));
    } catch (error) {
      errors.push(
        sanitizeDeep({ output_file: file, ...inspectionError(error) }),
      );
    }
  }
  return {
    attestations,
    total_token_count: attestations.reduce(
      (count, artifact) => count + artifact.stored_token_count,
      0,
    ),
    errors,
    note: 'Counts describe stored tokens. Usage outside the CLI is not tracked.',
  };
}
