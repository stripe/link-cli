import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'incur';
import { sanitizeText } from '../../utils/sanitize-text';

export class ArtifactReadError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function inspectionError(error: unknown) {
  if (!(error instanceof ArtifactReadError)) throw error;
  return { code: error.code, message: sanitizeText(error.message) };
}

function fileError(error: unknown, file: string): never {
  if (error instanceof ArtifactReadError) throw error;
  const code = (error as NodeJS.ErrnoException).code;
  throw new ArtifactReadError(
    code === 'ENOENT' ? 'ARTIFACT_NOT_FOUND' : 'ARTIFACT_READ_FAILED',
    `Cannot read saved identity artifact at ${file}${code ? ` (${code})` : ''}.`,
  );
}

/** Lists local JSON artifacts without creating directories or following symlinks. */
export async function listArtifactFiles(directory: string): Promise<string[]> {
  try {
    const stats = await fs.lstat(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new ArtifactReadError(
        'ARTIFACT_DIRECTORY_INVALID',
        `Artifact directory must be a directory, not a symbolic link: ${directory}`,
      );
    }
    const names = await fs.readdir(directory);
    return names
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => path.join(directory, name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    return fileError(error, directory);
  }
}

export async function readArtifact<T>(file: string, schema: z.ZodType<T>) {
  try {
    if ((await fs.lstat(file)).isSymbolicLink()) {
      throw new ArtifactReadError(
        'ARTIFACT_READ_FAILED',
        `Cannot inspect a symbolic-link artifact: ${file}`,
      );
    }
    // NONBLOCK prevents special files from hanging a local inspection command.
    const handle = await fs.open(
      file,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK,
    );
    let contents: string;
    try {
      const stats = await handle.stat();
      if (!stats.isFile() || stats.size > 4 * 1024 * 1024) {
        throw new ArtifactReadError(
          'ARTIFACT_INVALID',
          `Expected a regular identity artifact of at most 4 MiB: ${file}`,
        );
      }
      contents = await handle.readFile('utf8');
    } finally {
      await handle.close();
    }
    let data: unknown;
    try {
      data = JSON.parse(contents);
    } catch {
      // Parser diagnostics can quote credential bytes. Only report the path.
      throw new ArtifactReadError(
        'ARTIFACT_INVALID',
        `Invalid JSON in ${file}.`,
      );
    }
    const result = schema.safeParse(data);
    if (!result.success) {
      throw new ArtifactReadError(
        'ARTIFACT_INVALID',
        `Invalid or unsupported identity artifact in ${file}.`,
      );
    }
    return result.data;
  } catch (error) {
    return fileError(error, file);
  }
}
