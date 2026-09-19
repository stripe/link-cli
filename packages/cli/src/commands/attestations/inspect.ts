import { z } from 'incur';
import { sanitizeDeep } from '../../utils/sanitize-text';
import {
  inspectionError,
  listArtifactFiles,
  readArtifact,
} from '../identity/artifact-reader';
import { getOutputDirectory } from './storage';

const savedAttestationSchema = z
  .object({
    version: z.literal(1),
    issuer: z.url(),
    token_key_id: z.string().min(1),
    count: z.number().int().min(0).max(100),
    tokens: z
      .array(
        z.object({
          token: z.string().min(1),
          authorization: z.string().min(1),
        }),
      )
      .max(100),
  })
  .refine((artifact) => artifact.count === artifact.tokens.length);

async function inspectFile(file: string) {
  const artifact = await readArtifact(file, savedAttestationSchema);
  return sanitizeDeep({
    output_file: file,
    issuer: artifact.issuer,
    token_key_id: artifact.token_key_id,
    stored_token_count: artifact.tokens.length,
  });
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
    total_token_count: attestations.reduce(
      (count, artifact) => count + artifact.stored_token_count,
      0,
    ),
    errors,
    note: 'Counts describe stored tokens. Usage outside the CLI is not tracked.',
  };
}
