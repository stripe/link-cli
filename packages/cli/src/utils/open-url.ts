import { spawn } from 'node:child_process';

export function openUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) return;

    if (process.platform === 'darwin') {
      spawn('open', [parsed.toString()], {
        stdio: 'ignore',
        detached: true,
      }).unref();
    } else if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', parsed.toString()], {
        stdio: 'ignore',
        detached: true,
      }).unref();
    } else {
      spawn('xdg-open', [parsed.toString()], {
        stdio: 'ignore',
        detached: true,
      }).unref();
    }
  } catch {
    // Ignore invalid URL
  }
}
