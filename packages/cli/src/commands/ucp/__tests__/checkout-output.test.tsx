import type { IUcpResource, UcpCheckout } from '@stripe/link-sdk';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderInteractive } from '../../../utils/render-interactive';
import { createUcpCli } from '..';
import { CatalogSearch } from '../catalog-search';
import { CheckoutAction } from '../checkout-action';
import { CheckoutComplete } from '../checkout-complete';
import { CheckoutCreate } from '../checkout-create';
import { CheckoutRetrieve } from '../checkout-retrieve';

vi.mock('../../../utils/render-interactive', () => ({
  renderInteractive: vi.fn(async () => ({ id: 'checkout_1' })),
}));

const checkout: UcpCheckout = {
  id: 'checkout_1',
  status: 'ready_for_complete',
  messages: [{ code: 'review', content: 'Review shipping choices' }],
  fulfillment: { methods: [{ id: 'shipping', groups: [{ id: 'group_1' }] }] },
  ucp: {
    version: '2026-01-23',
    capabilities: { checkout: [{ version: '2026-01-23' }] },
  },
  totals: [{ type: 'total', amount: 5500 }],
  custom_metadata: { preserved: true },
};
const catalog = {
  data: [{ sku: 'sku_1', custom_metadata: { preserved: true } }],
};

const cases = [
  {
    name: 'catalog search',
    args: ['catalog', 'search', '--query', 'shoes'],
    component: CatalogSearch,
    result: catalog,
  },
  {
    name: 'checkout create',
    args: [
      'checkout',
      'create',
      '--business',
      'np_1',
      '--line-item',
      'id:sku_1',
    ],
    component: CheckoutCreate,
    result: checkout,
  },
  {
    name: 'checkout update',
    args: [
      'checkout',
      'update',
      '--id',
      'checkout_1',
      '--business',
      'np_1',
      '--buyer',
      'email:jane@example.com',
    ],
    component: CheckoutAction,
    result: checkout,
  },
  {
    name: 'checkout complete',
    args: [
      'checkout',
      'complete',
      'checkout_1',
      '--business',
      'np_1',
      '--spend-request-id',
      'lsrq_1',
    ],
    component: CheckoutComplete,
    result: checkout,
  },
  {
    name: 'checkout cancel',
    args: ['checkout', 'cancel', '--id', 'checkout_1', '--business', 'np_1'],
    component: CheckoutAction,
    result: { ...checkout, status: 'canceled' },
  },
  {
    name: 'checkout retrieve',
    args: ['checkout', 'retrieve', '--id', 'checkout_1', '--business', 'np_1'],
    component: CheckoutRetrieve,
    result: checkout,
  },
];

const originalTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
const originalExitCode = process.exitCode;

function setTty(tty: boolean) {
  Object.defineProperty(process.stdout, 'isTTY', {
    configurable: true,
    value: tty,
  });
}

async function run(args: string[]) {
  const repository: IUcpResource = {
    searchCatalog: vi.fn().mockResolvedValue(catalog),
    createCheckout: vi.fn().mockResolvedValue(checkout),
    updateCheckout: vi.fn().mockResolvedValue(checkout),
    completeCheckout: vi.fn().mockResolvedValue(checkout),
    cancelCheckout: vi
      .fn()
      .mockResolvedValue({ ...checkout, status: 'canceled' }),
    retrieveCheckout: vi.fn().mockResolvedValue(checkout),
  };
  let output = '';
  const exit = vi.fn();
  await createUcpCli(() => repository, undefined, 'test-token').serve(args, {
    stdout: (chunk) => {
      output += chunk;
    },
    exit,
  });
  expect(exit.mock.calls.every(([code]) => code === 0)).toBe(true);
  return { output, repository };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  process.exitCode = originalExitCode;
  if (originalTty) Object.defineProperty(process.stdout, 'isTTY', originalTty);
  else Reflect.deleteProperty(process.stdout, 'isTTY');
});

it('exits unsuccessfully for rejected interactive completion without appending JSON', async () => {
  setTty(true);
  vi.mocked(renderInteractive).mockImplementationOnce(
    async (element, getResult) => {
      const props = (
        element as ReactElement<{
          onComplete: (result: UcpCheckout, outcome: string) => void;
        }>
      ).props;
      props.onComplete(
        {
          id: 'checkout_1',
          status: 'incomplete',
          messages: [{ type: 'error', content: 'Select shipping' }],
        },
        'terminal_failure',
      );
      return getResult?.();
    },
  );
  const { output } = await run([
    'checkout',
    'complete',
    'checkout_1',
    '--business',
    'np_1',
    '--spend-request-id',
    'lsrq_1',
  ]);
  expect(process.exitCode).toBe(1);
  expect(output).toBe('');
});

describe.each(cases)('$name output', ({ args, component, result }) => {
  it('uses the terminal view by default without appending serialized output', async () => {
    setTty(true);
    const { output, repository } = await run(args);
    expect(renderInteractive).toHaveBeenCalledOnce();
    const element = vi.mocked(renderInteractive).mock
      .calls[0]?.[0] as ReactElement;
    expect(element.type).toBe(component);
    expect(output).toBe('');
    for (const method of Object.values(repository))
      expect(method).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'returns the full JSON with --format json (TTY: %s)',
    async (tty) => {
      setTty(tty);
      const { output, repository } = await run([...args, '--format', 'json']);
      expect(renderInteractive).not.toHaveBeenCalled();
      expect(JSON.parse(output)).toMatchObject(result);
      if (args[1] === 'complete')
        expect(repository.retrieveCheckout).not.toHaveBeenCalled();
    },
  );

  it('keeps structured output when stdout is piped', async () => {
    setTty(false);
    const { output } = await run(args);
    expect(renderInteractive).not.toHaveBeenCalled();
    expect(output).toContain('preserved: true');
  });
});

it('uses the terminal polling view with --poll and a spend request ID', async () => {
  setTty(true);
  await run([
    'checkout',
    'retrieve',
    'checkout_1',
    '--business',
    'np_1',
    '--spend-request-id',
    'lsrq_1',
    '--poll',
    '--timeout',
    '5',
  ]);
  const element = vi.mocked(renderInteractive).mock
    .calls[0]?.[0] as ReactElement<Record<string, unknown>>;
  expect(element.type).toBe(CheckoutRetrieve);
  expect(element.props).toMatchObject({
    business: 'np_1',
    spendRequestId: 'lsrq_1',
    poll: true,
    timeout: 5,
  });
});
