import type { ISummariesResource, SummariesPage } from '@stripe/link-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSummariesCli } from '../index';

const { renderInteractive } = vi.hoisted(() => ({
  renderInteractive: vi.fn(),
}));

vi.mock('../../../utils/render-interactive', () => ({
  renderInteractive,
}));

interface CliResult {
  output: string;
  exitCode: number | undefined;
}

async function serve(
  cli: ReturnType<typeof createSummariesCli>,
  argv: string[],
): Promise<CliResult> {
  let output = '';
  let exitCode: number | undefined;

  await cli.serve(argv, {
    stdout: (text) => {
      output += text;
    },
    exit: (code) => {
      exitCode = code;
    },
  });

  return { output, exitCode };
}

const page: SummariesPage = {
  data: [
    {
      id: 'sum_001',
      description: 'Your recent activity',
      created_at: '2026-09-15T18:30:00Z',
      status: 'ready',
      entries: [{ label: 'Payments', value: { unit: 'count', count: 7 } }],
    },
  ],
  has_more: false,
};

const originalIsTTY = process.stdout.isTTY;

describe('summaries list output policy', () => {
  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: originalIsTTY,
    });
    vi.clearAllMocks();
  });

  it('does not serialize summaries after the interactive renderer completes', async () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: true,
    });
    renderInteractive.mockImplementation(async (element, getResult) => {
      element.props.onComplete(page);
      return getResult?.();
    });
    const resource = {
      list: vi.fn(async () => page),
    } as unknown as ISummariesResource;
    const cli = createSummariesCli(() => resource, undefined, 'test-token');

    const result = await serve(cli, ['list']);

    expect(result.exitCode).toBeUndefined();
    expect(renderInteractive).toHaveBeenCalledOnce();
    // ensure it re-uses the result captured by the child list component, rather than making a duplicate API call
    expect(resource.list).not.toHaveBeenCalled();
    expect(result.output).toBe('');
  });

  it('serializes summaries when an output format is explicit', async () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: true,
    });
    const resource = {
      list: vi.fn(async () => page),
    } as unknown as ISummariesResource;
    const cli = createSummariesCli(() => resource, undefined, 'test-token');

    const result = await serve(cli, ['list', '--format', 'json']);

    expect(result.exitCode).toBeUndefined();
    expect(renderInteractive).not.toHaveBeenCalled();
    expect(JSON.parse(result.output)).toEqual(page);
  });
});
