import fs from 'node:fs/promises';
import path from 'node:path';

export async function writeCredentialFile(
  filePath: string,
  data: unknown,
  force: boolean,
): Promise<string> {
  const resolved = path.resolve(filePath);

  if (!force) {
    try {
      await fs.access(resolved);
      throw new Error(
        `OUTPUT_FILE_EXISTS: ${resolved} already exists. Use --force to overwrite.`,
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  await fs.writeFile(resolved, JSON.stringify(data, null, 2), {
    mode: 0o600,
  });
  await fs.chmod(resolved, 0o600);
  return resolved;
}
