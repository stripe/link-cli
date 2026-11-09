import type { IUcpResource, UcpCheckout } from '@stripe/link-sdk';
import { describe, expect, it, vi } from 'vitest';
import { createUcpCli } from '..';

const checkout: UcpCheckout = {
  id: 'dcs_1',
  status: 'complete_in_progress',
  messages: [{ content: 'Review order' }],
  custom_metadata: { preserved: true },
};

async function retrieve(
  retrieveCheckout: IUcpResource['retrieveCheckout'],
  tty: boolean,
  flags: string[] = [],
) {
  const originalTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  Object.defineProperty(process.stdout, 'isTTY', {
    configurable: true,
    value: tty,
  });
  try {
    const repository: IUcpResource = {
      searchCatalog: vi.fn(),
      createCheckout: vi.fn(),
      completeCheckout: vi.fn(),
      cancelCheckout: vi.fn(),
      updateCheckout: vi.fn(),
      retrieveCheckout,
    };
    const cli = createUcpCli(() => repository, undefined, 'test-access-token');
    let output = '';
    const exit = vi.fn();
    await cli.serve(
      ['checkout', 'retrieve', 'dcs_1', '--business', 'np_1', ...flags],
      {
        stdout: (chunk) => {
          output += chunk;
        },
        exit,
      },
    );
    return { output, exit, repository };
  } finally {
    if (originalTty)
      Object.defineProperty(process.stdout, 'isTTY', originalTty);
    else Reflect.deleteProperty(process.stdout, 'isTTY');
  }
}

describe('ucp checkout retrieve output', () => {
  it('prints checkout only when piped with one API request', async () => {
    const retrieveCheckout = vi.fn(async () => checkout);
    const { output, exit } = await retrieve(retrieveCheckout, false);
    expect(exit.mock.calls.every(([code]) => code === 0)).toBe(true);
    expect(retrieveCheckout).toHaveBeenCalledExactlyOnceWith('dcs_1', {
      business: 'np_1',
    });
    expect(output).toContain('dcs_1');
    expect(output).toContain('complete_in_progress');
  });

  it.each([true, false])(
    'returns the API checkout response as JSON (TTY: %s)',
    async (tty) => {
      const retrieveCheckout = vi.fn(async () => checkout);
      const { output, exit } = await retrieve(retrieveCheckout, tty, [
        '--format',
        'json',
      ]);
      expect(exit.mock.calls.every(([code]) => code === 0)).toBe(true);
      expect(JSON.parse(output)).toEqual(checkout);
      expect(retrieveCheckout).toHaveBeenCalledExactlyOnceWith('dcs_1', {
        business: 'np_1',
      });
    },
  );

  it.each([true, false])(
    'rejects removed options before any API request (TTY: %s)',
    async (tty) => {
      for (const flags of [
        ['--poll'],
        ['--timeout', '10'],
        ['--spend-request-id', 'lsrq_1'],
      ]) {
        const retrieveCheckout = vi.fn(async () => checkout);
        const { output, exit, repository } = await retrieve(
          retrieveCheckout,
          tty,
          [...flags, '--format', 'json'],
        );
        expect(exit).toHaveBeenCalledWith(1);
        expect(JSON.parse(output).code).toBeDefined();
        for (const method of Object.values(repository))
          expect(method).not.toHaveBeenCalled();
      }
    },
  );
});
