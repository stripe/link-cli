import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { render } from 'ink-testing-library';
import { expect, it, vi } from 'vitest';
import { storage } from '../../../auth/storage';
import type { IAuthResource } from '../../../auth/types';
import { Login } from '../login';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('../../../auth/storage', () => ({
  storage: { setTokens: vi.fn() },
}));

it('keeps the manual login URL and polling available when browser launch fails', async () => {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
  vi.mocked(spawn).mockReturnValue(
    child as unknown as ReturnType<typeof spawn>,
  );
  const verificationUrl = 'https://example.invalid/authorize';
  const authResource = {
    initiateDeviceAuth: vi.fn().mockResolvedValue({
      device_code: 'device_test',
      user_code: 'test phrase',
      verification_url: verificationUrl,
      verification_url_complete: verificationUrl,
      expires_in: 600,
      interval: 2,
    }),
    pollDeviceAuth: vi.fn().mockResolvedValue(null),
    refreshToken: vi.fn(),
    revokeToken: vi.fn(),
  } satisfies IAuthResource;
  const onComplete = vi.fn();
  const { lastFrame, stdin, unmount } = render(
    <Login authResource={authResource} onComplete={onComplete} />,
  );
  const setRawMode = vi.spyOn(stdin, 'setRawMode');

  try {
    await vi.waitFor(() => expect(lastFrame()).toContain(verificationUrl));
    // Ink installs its input listener after rendering the manual URL.
    await vi.waitFor(() => expect(setRawMode).toHaveBeenCalledWith(true));
    stdin.write('\r');
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    expect(() =>
      child.emit('error', new Error('opener unavailable')),
    ).not.toThrow();

    await vi.advanceTimersByTimeAsync(3000);
    expect(authResource.pollDeviceAuth).toHaveBeenCalledWith('device_test');
    expect(lastFrame()).toContain(verificationUrl);
    expect(lastFrame()).toContain('Waiting for authorization');
    expect(storage.setTokens).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();

    const tokens = {
      access_token: 'test_access_token',
      refresh_token: 'test_refresh_token',
      expires_in: 3600,
      token_type: 'Bearer',
    };
    authResource.pollDeviceAuth.mockResolvedValueOnce(tokens);
    await vi.advanceTimersByTimeAsync(2000);
    expect(storage.setTokens).toHaveBeenCalledWith(tokens);
    await vi.waitFor(() =>
      expect(lastFrame()).toContain('Successfully authenticated!'),
    );
  } finally {
    unmount();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  }
});
