import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// We need to capture stderr and test the jsonFn path runs on no-TTY.
// executeCommand calls process.stderr.write directly, so spy on that.

describe('executeCommand — no-TTY fallback', () => {
  let stderrOutput: string[];
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    vi.resetModules();
    stderrOutput = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrOutput.push(String(chunk));
      return true;
    });
    originalIsTTY = process.stdout.isTTY;
    process.stdout.isTTY = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // @ts-expect-error — originalIsTTY is boolean | undefined but isTTY is boolean
    process.stdout.isTTY = originalIsTTY;
  });

  it('runs jsonFn and emits TTY notices when isTTY is false and outputJson is false', async () => {
    const jsonFn = vi.fn().mockResolvedValue({ ok: true });
    const renderFn = vi.fn();

    // Import after mocking so the module sees the patched isTTY
    const { executeCommand } = await import('../execute-command.js');
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await executeCommand({ outputJson: false, jsonFn, renderFn });

    expect(jsonFn).toHaveBeenCalledOnce();
    expect(renderFn).not.toHaveBeenCalled();

    const stderr = stderrOutput.join('');
    expect(stderr).toContain('No TTY detected');
    expect(stderr).toContain('link-cli skill');
  });

  it('does NOT emit TTY notices when outputJson is explicitly true', async () => {
    const jsonFn = vi.fn().mockResolvedValue({ ok: true });
    const renderFn = vi.fn();

    const { executeCommand } = await import('../execute-command.js');
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await executeCommand({ outputJson: true, jsonFn, renderFn });

    const stderr = stderrOutput.join('');
    expect(stderr).not.toContain('No TTY detected');
  });
});
