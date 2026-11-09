import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

import { openUrl } from '../open-url';

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform });
}

beforeEach(() => {
  spawnMock.mockReset();
  spawnMock.mockReturnValue({ on: vi.fn(), unref: vi.fn() });
});

afterEach(() => {
  setPlatform(originalPlatform);
  vi.unstubAllEnvs();
});

describe('openUrl', () => {
  it('launches rundll32 by absolute path on Windows, never cmd', () => {
    setPlatform('win32');
    vi.stubEnv('SystemRoot', 'C:\\Windows');
    const url = 'https://link.com/verify?a=1&calc|x^y%PATH%';

    openUrl(url);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command, args] = spawnMock.mock.calls[0];
    expect(command).toBe('C:\\Windows\\System32\\rundll32.exe');
    expect(args).toEqual([
      'url.dll,FileProtocolHandler',
      new URL(url).toString(),
    ]);
  });

  it('ignores a relative SystemRoot on Windows', () => {
    setPlatform('win32');
    vi.stubEnv('SystemRoot', '.');
    vi.stubEnv('windir', '');

    openUrl('https://link.com');

    expect(spawnMock.mock.calls[0][0]).toBe(
      'C:\\Windows\\System32\\rundll32.exe',
    );
  });

  it('launches /usr/bin/open on macOS', () => {
    setPlatform('darwin');

    openUrl('https://link.com/');

    expect(spawnMock).toHaveBeenCalledWith(
      '/usr/bin/open',
      ['https://link.com/'],
      expect.any(Object),
    );
  });

  it('launches xdg-open on Linux', () => {
    setPlatform('linux');

    openUrl('https://link.com/');

    expect(spawnMock.mock.calls[0][0]).toBe('xdg-open');
  });

  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'not a url'])(
    'does not spawn for %s',
    (url) => {
      setPlatform('win32');

      openUrl(url);

      expect(spawnMock).not.toHaveBeenCalled();
    },
  );
});
