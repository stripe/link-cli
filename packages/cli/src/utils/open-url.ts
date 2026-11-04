import { spawn } from 'node:child_process';

export function openUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) return;

    // Browser opening is best-effort; callers also display the URL.
    if (process.platform === 'darwin') {
      spawn('open', [parsed.toString()], {
        stdio: 'ignore',
        detached: true,
      })
        .on('error', () => {})
        .unref();
    } else if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', parsed.toString()], {
        stdio: 'ignore',
        detached: true,
      })
        .on('error', () => {})
        .unref();
    } else {
      spawn('xdg-open', [parsed.toString()], {
        stdio: 'ignore',
        detached: true,
      })
        .on('error', () => {})
        .unref();
    }
  } catch {
    // Ignore invalid URLs and synchronous launch failures.
  }
}
