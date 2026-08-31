import type {
  ITransactionsResource,
  Transaction,
  TransactionsPage,
} from '@stripe/link-sdk';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { sanitizeResource } from '../../../utils/resource-factory';
import { TransactionsList } from '../list';
import { TransactionUpdate } from '../update';

const ESCAPE_PAYLOAD = '\x1b[2JEvil\rText';
const CLEAN_TEXT = 'EvilText';

function makeResource(page: TransactionsPage): ITransactionsResource {
  return sanitizeResource({
    list: vi.fn(async () => page),
  } as unknown as ITransactionsResource);
}

function makeUpdateResource(result: Transaction): ITransactionsResource {
  return sanitizeResource({
    update: vi.fn(async () => result),
  } as unknown as ITransactionsResource);
}

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'lbctxn_1',
    source_id: null,
    amount: -979,
    currency: 'usd',
    created_date: '2026-06-08',
    description: 'Chase',
    origin: 'external_connection',
    category: 'credit_card_payment',
    status: 'succeeded',
    ...overrides,
  };
}

describe('transactions list component', () => {
  it('renders transaction descriptions and amounts', async () => {
    const resource = makeResource({
      data: [transaction()],
    });

    const { lastFrame } = render(
      <TransactionsList resource={resource} onComplete={() => {}} />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('Date');
      expect(frame).toContain('Amount');
      expect(frame).toContain('Status');
      expect(frame).toContain('Category');
      expect(frame).toContain('Description');
      expect(frame).toContain('Chase');
      expect(frame).toContain('$9.79');
      expect(frame).toContain('2026-06-08');
    });
  });

  it('renders an empty state when there are no transactions', async () => {
    const resource = makeResource({ data: [] });

    const { lastFrame } = render(
      <TransactionsList resource={resource} onComplete={() => {}} />,
    );

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('No transactions found');
    });
  });

  it('sanitizes escape sequences in transaction fields', async () => {
    const resource = makeResource({
      data: [transaction({ description: ESCAPE_PAYLOAD })],
    });

    const { lastFrame } = render(
      <TransactionsList resource={resource} onComplete={() => {}} />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain(CLEAN_TEXT);
      expect(frame).not.toContain('\x1b[2J');
      expect(frame).not.toContain('\r');
    });
  });

  it('leaves the category column blank when category is null', async () => {
    const resource = makeResource({
      data: [
        transaction({
          id: 'lbctxn_2',
          amount: 72900,
          created_date: '2026-05-29',
          description: 'Zelle Transfer from Francesca Piretto',
          category: null,
        }),
      ],
    });

    const { lastFrame } = render(
      <TransactionsList resource={resource} onComplete={() => {}} />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('Zelle Transfer from Francesca Piretto');
      expect(frame).toMatch(/succeeded\s{16,}Zelle Transfer/);
      expect(frame).not.toContain('null');
      expect(frame).not.toContain(' - ');
    });
  });

  it('renders pagination metadata when available', async () => {
    const resource = makeResource({
      data: [transaction({ id: 'lbctxn_3' })],
      has_more: true,
    });

    const { lastFrame } = render(
      <TransactionsList resource={resource} onComplete={() => {}} />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('has_more: true');
      expect(frame).toContain('--starting-after lbctxn_3');
    });
  });

  it('renders has_more false without a next-page hint', async () => {
    const resource = makeResource({
      data: [transaction({ id: 'lbctxn_4' })],
      has_more: false,
    });

    const { lastFrame } = render(
      <TransactionsList resource={resource} onComplete={() => {}} />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('has_more: false');
      expect(frame).not.toContain('--starting-after');
    });
  });
});

describe('transactions update component', () => {
  it('renders the updated transaction', async () => {
    const resource = makeUpdateResource(
      transaction({ category: 'groceries', description: 'Trader Joes' }),
    );

    const { lastFrame } = render(
      <TransactionUpdate
        resource={resource}
        id="lbctxn_1"
        params={{ category: 'groceries', description: 'Trader Joes' }}
        onComplete={() => {}}
      />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('Transaction updated');
      expect(frame).toContain('lbctxn_1');
      expect(frame).toContain('Trader Joes');
      expect(frame).toContain('groceries');
      expect(frame).toContain('-$9.79');
      expect(frame).toContain('2026-06-08');
      expect(frame).toContain('succeeded');
    });
  });

  it('renders an error state when the resource rejects', async () => {
    const resource = sanitizeResource({
      update: vi.fn(async () => {
        throw new Error('Invalid category: shopping');
      }),
    } as unknown as ITransactionsResource);

    const { lastFrame } = render(
      <TransactionUpdate
        resource={resource}
        id="lbctxn_1"
        params={{ category: 'shopping' }}
        onComplete={() => {}}
      />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('Failed to update transaction');
      expect(frame).toContain('Invalid category: shopping');
    });
  });

  it('sanitizes escape sequences in the updated transaction', async () => {
    const resource = makeUpdateResource(
      transaction({ description: ESCAPE_PAYLOAD }),
    );

    const { lastFrame } = render(
      <TransactionUpdate
        resource={resource}
        id="lbctxn_1"
        params={{ description: ESCAPE_PAYLOAD }}
        onComplete={() => {}}
      />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain(CLEAN_TEXT);
      expect(frame).not.toContain('\x1b[2J');
      expect(frame).not.toContain('\r');
    });
  });
});
