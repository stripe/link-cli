import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function writeCredentialFile(
  filePath: string,
  data: unknown,
  force: boolean,
): Promise<string> {
  const resolved = path.resolve(filePath);

  // Atomically create the output file with O_EXCL | O_NOFOLLOW so we never
  // write through a pre-existing symlink. The previous implementation used
  // fs.access() then fs.writeFile() which followed symlinks: an attacker on
  // a shared filesystem (CI runner, multi-user host, container with shared
  // tmp) could pre-plant a symlink at the operator's --output-file path,
  // pre-open a file descriptor against the symlink target while it was
  // world-readable, then read the credential through that fd after the
  // operator's writeFile resolved the symlink and wrote the card data.
  // The follow-up fs.chmod(resolved, 0o600) would then race-finalize the
  // target permissions to owner-only — too late, the attacker's fd was
  // open before chmod and survives it.
  //
  // O_NOFOLLOW makes open() refuse to traverse the final path component
  // when it is a symbolic link (returns ELOOP). O_EXCL makes open() refuse
  // to operate on a pre-existing file (returns EEXIST). The mode argument
  // is only consulted when O_CREAT actually creates the file — combined
  // with O_EXCL this guarantees the file is created here and nowhere else.
  if (force) {
    // Remove any pre-existing entry, including a symlink. Use fs.unlink
    // which operates on the symlink itself rather than its target. ENOENT
    // is fine; anything else (EISDIR, EACCES) surfaces to the caller.
    try {
      await fs.unlink(resolved);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(
      resolved,
      // biome-ignore lint/suspicious/noBitwiseInsideUnaryExpression: standard open(2) flag composition
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
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
