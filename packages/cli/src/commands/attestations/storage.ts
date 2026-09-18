import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'incur';
import { writeCredentialFile } from '../../utils/credential-output';
import { readArtifact } from '../identity/artifact-reader';
import {
  type AttestationExport,
  authorizationHeader,
  savedAttestationSchema,
} from './export';

const poolSchema = z
  .object({
    version: z.literal(2),
    batches: z.array(savedAttestationSchema.refine((batch) => batch.count > 0)),
  })
  .refine((pool) => {
    const tokens = pool.batches.flatMap((batch) =>
      batch.tokens.map(({ token }) => token),
    );
    return new Set(tokens).size === tokens.length;
  });
type AttestationPool = z.infer<typeof poolSchema>;

export function getOutputDirectory(): string {
  return path.join(os.homedir(), '.link-cli', 'attestations');
}

export function getPoolPath(): string {
  return path.join(getOutputDirectory(), 'pool.json');
}

export function readAttestationPool() {
  return readArtifact(getPoolPath(), poolSchema);
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

async function writePool(pool: AttestationPool) {
  const temporary = path.join(
    getOutputDirectory(),
    `.pool-${randomUUID()}.tmp`,
  );
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(JSON.stringify(pool));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, getPoolPath());
    // Node cannot open directories for fsync on Windows.
    if (process.platform !== 'win32') {
      const directory = await fs.open(getOutputDirectory(), 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function lockPool() {
  const lockPath = `${getPoolPath()}.lock`;
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.mkdir(lockPath, { mode: 0o700 });
      return () => fs.rmdir(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (attempt === 20) {
        throw Object.assign(
          new Error(
            `Attestation pool is locked at ${lockPath}. If a command crashed, ensure no attestation commands are running before removing that lock directory.`,
          ),
          { code: 'ATTESTATION_POOL_LOCKED' },
        );
      }
      // Never steal a lock based on age: its owner may be paused and resume.
      await delay(250);
    }
  }
}

async function updatePool<T>(update: (pool: AttestationPool) => T): Promise<T> {
  await prepareOutputDirectory();
  const release = await lockPool();
  try {
    let pool: AttestationPool;
    try {
      pool = await readAttestationPool();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      pool = { version: 2, batches: [] };
    }
    const result = update(pool);
    if (!poolSchema.safeParse(pool).success) {
      throw new Error('Invalid attestation pool or duplicate tokens.');
    }
    await writePool(pool);
    return result;
  } finally {
    await release();
  }
}

export async function addAttestationsToPool(
  artifact: AttestationExport,
): Promise<string> {
  await updatePool((pool) => {
    pool.batches.push(artifact);
  });
  return getPoolPath();
}

export async function takeAttestation() {
  // Commit removal before returning any token bytes. A crash can lose a token,
  // but retrying must never return that token to another caller.
  return updatePool((pool) => {
    const batch = pool.batches[0];
    const token = batch?.tokens.shift();
    if (!batch || !token) {
      throw Object.assign(
        new Error(
          'The attestation pool is empty. Run identity attestations request --count 10 to refill it.',
        ),
        { code: 'ATTESTATION_POOL_EMPTY' },
      );
    }
    batch.count = batch.tokens.length;
    if (batch.count === 0) pool.batches.shift();
    if (!/^[A-Za-z0-9_-]+={0,2}$/.test(token.token)) {
      throw new Error('Invalid attestation token encoding.');
    }
    return {
      issuer: batch.issuer,
      token_key_id: batch.token_key_id,
      token: token.token,
      authorization: authorizationHeader(token.token),
    };
  });
}

async function canonicalPath(file: string): Promise<string> {
  try {
    return await fs.realpath(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = path.dirname(file);
    if (parent === file) throw error;
    return path.join(await canonicalPath(parent), path.basename(file));
  }
}

export async function validateExportPath(outputFile: string): Promise<void> {
  const [directory, destination] = await Promise.all([
    canonicalPath(getOutputDirectory()),
    canonicalPath(path.resolve(outputFile)),
  ]);
  const relative = path.relative(directory, destination);
  if (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  ) {
    throw new Error(
      'Choose an export path outside the CLI attestation storage directory.',
    );
  }
}

export async function exportAttestationArtifact(
  artifact: AttestationExport,
  outputFile: string,
): Promise<string> {
  await validateExportPath(outputFile);
  return writeCredentialFile(outputFile, artifact, false);
}
