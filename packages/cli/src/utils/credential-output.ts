import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function writeCredentialFile(
  filePath: string,
  data: unknown,
  force: boolean,
): Promise<string> {
  const resolved = path.resolve(filePath);

  // Atomically create the credential file so we never write through a
  // pre-existing output path. On POSIX, O_NOFOLLOW refuses to follow a
  // symlink at the final path component; O_EXCL makes create fail if an
  // entry already exists. The 0o600 mode is applied at create time, so
  // the file is owner-only the moment it exists.
  if (force) {
    // fs.unlink operates on the symlink itself rather than its target.
    try {
      await fs.unlink(resolved);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
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
