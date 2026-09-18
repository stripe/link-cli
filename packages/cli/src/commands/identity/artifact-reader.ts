import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'incur';
import { sanitizeText } from '../../utils/sanitize-text';

export function inspectionError(error: unknown) {
  if (!(error instanceof Error)) throw error;
  return {
    code: (error as NodeJS.ErrnoException).code ?? 'INVALID_INPUT',
    message: sanitizeText(error.message),
  };
}

async function checkDirectory(directory: string) {
  if (!(await fs.lstat(directory)).isDirectory()) {
    throw new Error(
      `Expected an artifact directory, not a symbolic link: ${directory}`,
    );
  }
}

export async function listArtifactFiles(directory: string) {
  try {
    await checkDirectory(directory);
    return (await fs.readdir(directory))
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => path.join(directory, name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function readArtifact<T>(file: string, schema: z.ZodType<T>) {
  await checkDirectory(path.dirname(file));
  if (!(await fs.lstat(file)).isFile()) {
    throw new Error(
      `Expected a regular artifact file, not a symbolic link: ${file}`,
    );
  }
  const contents = await fs.readFile(file, {
    encoding: 'utf8',
    flag:
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK,
  });
  let data: unknown;
  try {
    data = JSON.parse(contents);
  } catch {
    // JSON parser errors can quote credential bytes.
    throw new Error(`Invalid JSON in ${file}.`);
  }
  const result = schema.safeParse(data);
  if (!result.success)
    throw new Error(`Invalid or unsupported identity artifact in ${file}.`);
  return result.data;
}
