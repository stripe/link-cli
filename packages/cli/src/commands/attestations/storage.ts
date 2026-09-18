import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeCredentialFile } from '../../utils/credential-output';
import type { AttestationExport } from './export';

export function getOutputDirectory(): string {
  return path.join(os.homedir(), '.link-cli', 'attestations');
}

async function prepareOutputDirectory(): Promise<string> {
  const directory = getOutputDirectory();
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stats = await fs.lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(
      `ATTESTATION_OUTPUT_DIRECTORY_INVALID: ${directory} must be a directory, not a symbolic link`,
    );
  }
  await fs.chmod(directory, 0o700);
  return directory;
}

export async function writeAttestationArtifact(
  artifact: AttestationExport,
): Promise<string> {
  const directory = await prepareOutputDirectory();
  const outputFile = path.join(
    directory,
    `attestations-${Date.now()}-${randomUUID()}.json`,
  );
  return writeCredentialFile(outputFile, artifact, false);
}
