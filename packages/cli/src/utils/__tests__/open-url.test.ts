import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openUrl } from '../open-url';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

const originalPlatform = process.platform;
const url = 'https://example.invalid/authorize?code=example';

describe('openUrl', () => {
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() });

  beforeEach(() => {
    vi.clearAllMocks();
    child.removeAllListeners();
    vi.mocked(spawn).mockReturnValue(
      child as unknown as ReturnType<typeof spawn>,
    );
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    vi.restoreAllMocks();
  });

  it.each([
    ['darwin', 'open', [url]],
    ['win32', 'cmd', ['/c', 'start', '', url]],
    ['linux', 'xdg-open', [url]],
  ] as const)(
    'keeps browser launch failures non-fatal on %s',
    (platform, command, args) => {
      Object.defineProperty(process, 'platform', { value: platform });

      expect(openUrl(url)).toBeUndefined();
      expect(spawn).toHaveBeenCalledWith(command, args, {
        stdio: 'ignore',
        detached: true,
      });
      expect(child.unref).toHaveBeenCalledOnce();
      expect(() =>
        child.emit('error', new Error('opener unavailable')),
      ).not.toThrow();
    },
  );

  it.each(['not a URL', 'file:///tmp/example', 'javascript:alert(1)'])(
    'does not start a browser for %s',
    (value) => {
      expect(openUrl(value)).toBeUndefined();
      expect(spawn).not.toHaveBeenCalled();
    },
  );

  it('preserves HTTP URL normalization and successful launches', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    openUrl('http://example.invalid');
    expect(spawn).toHaveBeenCalledWith(
      'xdg-open',
      ['http://example.invalid/'],
      { stdio: 'ignore', detached: true },
    );
    child.emit('spawn');
    child.emit('exit', 0, null);
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it('continues to ignore synchronous launch failures', () => {
    vi.mocked(spawn).mockImplementationOnce(() => {
      throw new Error('spawn failed');
    });
    expect(() => openUrl(url)).not.toThrow();
  });
});
