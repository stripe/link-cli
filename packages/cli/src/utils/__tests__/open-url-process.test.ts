import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

it('survives a real asynchronous ENOENT from the browser opener', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'link-cli-open-url-'));
  const moduleUrl = new URL('../open-url.ts', import.meta.url).href;
  try {
    // Redirect only the opener executable to an absent absolute path. This
    // exercises a real child-process error without launching a browser on
    // any platform or relying on the host's installed commands.
    const script = `
      import childProcess from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      const spawn = childProcess.spawn;
      childProcess.spawn = (_command, args, options) =>
        spawn(${JSON.stringify(join(directory, 'missing-opener'))}, args, options);
      syncBuiltinESMExports();
      const { openUrl } = await import(${JSON.stringify(moduleUrl)});
      openUrl('https://example.invalid/');
      setTimeout(() => console.log('survived'), 25);
    `;
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        '--import',
        import.meta.resolve('tsx'),
        '--input-type=module',
        '-e',
        script,
      ],
      { timeout: 5000 },
    );
    expect(stdout.trim()).toBe('survived');
    expect(stderr).toBe('');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
