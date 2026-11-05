import { spawn } from 'node:child_process';
import path from 'node:path';

// Windows resolves bare executable names against the current directory before
// PATH, so a planted `cmd.exe` in the working directory would run instead of
// the system copy. Always launch OS binaries by absolute path, and never route
// the URL through cmd.exe (which would parse `&`, `|`, `^`, `%` in it).
function windowsSystem32(): string {
  const root = process.env.SystemRoot ?? process.env.windir;
  const systemRoot = root && path.win32.isAbsolute(root) ? root : 'C:\\Windows';
  return path.win32.join(systemRoot, 'System32');
}

export function openUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) return;

    let command: string;
    let args: string[];
    if (process.platform === 'darwin') {
      command = '/usr/bin/open';
      args = [parsed.toString()];
    } else if (process.platform === 'win32') {
      command = path.win32.join(windowsSystem32(), 'rundll32.exe');
      args = ['url.dll,FileProtocolHandler', parsed.toString()];
    } else {
      command = 'xdg-open';
      args = [parsed.toString()];
    }

    const child = spawn(command, args, {
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Ignore invalid URL
  }
}
