import { constants, type Stats } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function writeCredentialFile(
  filePath: string,
  data: unknown,
  force: boolean,
): Promise<string> {
  const resolved = path.resolve(filePath);

  // Atomically create the credential file so we never write through a
  // pre-existing output path. lstat first to inspect what is there: a
  // symlink at the final path component is rejected outright (even with
  // --force), since --force is meant to replace an existing output file,
  // not to authorize writing credentials over or through a symlink. A
  // regular file is overwritten only when --force is set. The atomic
  // create below uses O_EXCL | O_NOFOLLOW so the race window between the
  // precheck and the create is fail-closed.
  let existing: Stats | undefined;
  try {
    existing = await fs.lstat(resolved);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  if (existing?.isSymbolicLink()) {
    throw new Error(
      `OUTPUT_FILE_SYMLINK: ${resolved} is a symbolic link. Refusing to write credentials through it.`,
    );
  }

  if (existing) {
    if (!force) {
      throw new Error(
        `OUTPUT_FILE_EXISTS: ${resolved} already exists. Use --force to overwrite.`,
      );
    }
    await fs.unlink(resolved);
  }

  // O_NOFOLLOW is POSIX-only. On Windows, Node exposes it as 0, so the
  // bitwise OR is a no-op there: O_EXCL still prevents overwriting a
  // pre-existing entry, but open() does not provide full no-follow
  // semantics on Windows.
  const noFollowFlag = constants.O_NOFOLLOW ?? 0;

  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(
      resolved,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollowFlag,
      0o600,
    );
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      throw new Error(
        `OUTPUT_FILE_EXISTS: ${resolved} already exists. Use --force to overwrite.`,
      );
    }
    if (code === 'ELOOP') {
      throw new Error(
        `OUTPUT_FILE_SYMLINK: ${resolved} is a symbolic link. Refusing to write credentials through it.`,
      );
    }
    throw err;
  }

  try {
    await handle.write(JSON.stringify(data, null, 2));
  } finally {
    await handle.close();
  }
  return resolved;
}
