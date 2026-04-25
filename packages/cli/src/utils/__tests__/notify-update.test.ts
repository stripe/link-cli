import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyUpdate } from '../notify-update';

describe('notifyUpdate', () => {
  let stderrWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrWrite = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stderrWrite.mockRestore();
  });

  it('does nothing when update is undefined', () => {
    notifyUpdate(undefined, '@stripe/link-cli', false);
    expect(stderrWrite).not.toHaveBeenCalled();
  });

  it('does nothing in interactive mode (notifier.notify() handles it)', () => {
    notifyUpdate(
      { current: '0.1.0', latest: '0.2.0' },
      '@stripe/link-cli',
      false,
    );
    expect(stderrWrite).not.toHaveBeenCalled();
  });

  it('writes JSON to stderr in JSON mode when update is available', () => {
    notifyUpdate(
      { current: '0.1.0', latest: '0.2.0' },
      '@stripe/link-cli',
      true,
    );
    expect(stderrWrite).toHaveBeenCalledOnce();
    const written = stderrWrite.mock.calls[0][0] as string;
    const parsed = JSON.parse(written.trim());
    expect(parsed).toEqual({
      type: 'update_available',
      current_version: '0.1.0',
      latest_version: '0.2.0',
      update_command: 'npm install -g @stripe/link-cli',
    });
  });
});
