import type { BalancesPage, IBalancesResource } from '@stripe/link-sdk';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { sanitizeResource } from '../../../utils/resource-factory';
import { BalancesList } from '../list';

const ESCAPE_PAYLOAD = '\x1b[2JEvil\rHidden';
const CLEAN_TEXT = 'EvilHidden';

function makeResource(page: BalancesPage): IBalancesResource {
  return sanitizeResource({
    list: vi.fn(async () => page),
  } as unknown as IBalancesResource);
}

describe('balances list component', () => {
  it('renders balance details', async () => {
    const resource = makeResource({
      data: [
        {
          source_id: 'csmrpd_1',
          type: 'cash',
          cash: { available: { usd: 12500 } },
          current: 13000,
          currency: 'usd',
          as_of: '2026-07-14T00:00:00Z',
        },
      ],
    });

    const { lastFrame } = render(
      <BalancesList resource={resource} onComplete={() => {}} />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('Source ID');
      expect(frame).toContain('Balance type');
      expect(frame).toContain('Current balance');
      expect(frame).toContain('Currency');
      expect(frame).toContain('csmrpd_1');
      expect(frame).toContain('cash');
      expect(frame).toContain('$130.00');
      expect(frame).toContain('usd');
    });
  });

  it('renders credit balance with used amount', async () => {
    const resource = makeResource({
      data: [
        {
          source_id: 'csmrpd_2',
          type: 'credit',
          credit: { used: { usd: 5000 } },
          current: 10000,
          currency: 'usd',
          as_of: '2026-07-14T00:00:00Z',
        },
      ],
    });

    const { lastFrame } = render(
      <BalancesList resource={resource} onComplete={() => {}} />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('csmrpd_2');
      expect(frame).toContain('credit');
      expect(frame).toContain('$100.00');
      expect(frame).toContain('usd');
    });
  });

  it.each([
    [1234, 'eur', '€12.34'],
    [1000, 'jpy', '¥1,000'],
    [1000, 'kwd', 'KWD\u00a01.000'],
    [-1234, 'usd', '-$12.34'],
    [-1000, 'jpy', '-¥1,000'],
    [0, 'jpy', '¥0'],
  ])(
    'formats a balance of %d %s as %s',
    async (current, currency, expected) => {
      const resource = makeResource({
        data: [
          {
            source_id: 'csmrpd_1',
            type: 'cash',
            current,
            currency,
            as_of: '2026-07-14T00:00:00Z',
          },
        ],
      });

      const { lastFrame } = render(
        <BalancesList resource={resource} onComplete={() => {}} />,
      );

      await vi.waitFor(() => {
        expect(lastFrame()).toContain(expected);
      });
    },
  );

  it('renders an empty state when there are no balances', async () => {
    const resource = makeResource({ data: [] });

    const { lastFrame } = render(
      <BalancesList resource={resource} onComplete={() => {}} />,
    );

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('No balances found');
    });
  });

  it('sanitizes escape sequences in balance fields', async () => {
    const resource = makeResource({
      data: [
        {
          source_id: ESCAPE_PAYLOAD,
          type: 'cash',
          current: 0,
          currency: ESCAPE_PAYLOAD,
          as_of: '2026-07-14T00:00:00Z',
        },
      ],
    });

    const { lastFrame } = render(
      <BalancesList resource={resource} onComplete={() => {}} />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain(CLEAN_TEXT);
      expect(frame).not.toContain('\x1b[2J');
      expect(frame).not.toContain('\r');
    });
  });

  it('renders pagination metadata when available', async () => {
    const resource = makeResource({
      data: [
        {
          source_id: 'csmrpd_2',
          type: 'cash',
          current: 5000,
          currency: 'usd',
          as_of: '2026-07-14T00:00:00Z',
        },
      ],
      has_more: true,
    });

    const { lastFrame } = render(
      <BalancesList resource={resource} onComplete={() => {}} />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('has_more: true');
      expect(frame).toContain('--starting-after csmrpd_2');
    });
  });

  it('preserves the baseline cash and credit frame byte-for-byte', async () => {
    const resource = makeResource({
      data: [
        {
          source_id: 'csmrpd_1',
          type: 'cash',
          cash: { available: { usd: 12500 } },
          current: 13000,
          currency: 'usd',
          as_of: '2026-07-14T00:00:00Z',
        },
        {
          source_id: 'csmrpd_2',
          type: 'credit',
          credit: { used: { usd: 5000 } },
          current: 10000,
          currency: 'usd',
          as_of: '2026-07-14T00:00:00Z',
        },
      ],
      has_more: false,
    });
    const { lastFrame } = render(
      <BalancesList resource={resource} onComplete={() => {}} />,
    );
    await vi.waitFor(() =>
      expect(lastFrame()).toBe(
        'Balances\n\n  Source name   Source ID         Balance type  Current balance  Currency\n  -----------------------------------------------------------------------\n  -             csmrpd_1          cash          $130.00          usd\n  -             csmrpd_2          credit        $100.00          usd\n\nhas_more: false',
      ),
    );
  });

  it('distinguishes investment portfolio value, available cash, and margin', async () => {
    const { lastFrame } = render(
      <BalancesList
        resource={makeResource({
          data: [
            {
              source_id: 'csmrpd_investment',
              type: 'investment',
              current: 100000,
              currency: 'usd',
              as_of: '2026-11-15',
              investment: {
                available_cash: { usd: 12000 },
                margin: { usd: 30000 },
              },
            },
          ],
        })}
        onComplete={() => {}}
      />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Portfolio value: $1,000.00');
      expect(lastFrame()).toContain('Cash: $120.00');
      expect(lastFrame()).toContain('Margin: $300.00');
    });
  });

  it.each([
    [null, ['Cash: unknown', 'Margin: unknown'], []],
    [{ available_cash: null }, ['Cash: unknown'], ['Margin:']],
    [{ margin: { usd: 0 } }, ['Margin: $0.00'], ['Cash:']],
    [{}, [], ['Cash:', 'Margin:']],
  ] as const)(
    'keeps unknown and omitted investment amounts distinct: %j',
    async (investment, expected, absent) => {
      const { lastFrame } = render(
        <BalancesList
          resource={makeResource({
            data: [
              {
                source_id: 'csmrpd_investment',
                type: 'investment',
                current: 100000,
                currency: 'usd',
                as_of: '2026-11-15',
                investment,
              },
            ],
          })}
          onComplete={() => {}}
        />,
      );
      await vi.waitFor(() => {
        expect(lastFrame()).toContain('Portfolio value: $1,000.00');
        for (const text of expected) expect(lastFrame()).toContain(text);
        for (const text of absent) expect(lastFrame()).not.toContain(text);
      });
    },
  );

  it('labels an investment portfolio when the nested data is omitted', async () => {
    const { lastFrame } = render(
      <BalancesList
        resource={makeResource({
          data: [
            {
              source_id: 'csmrpd_investment',
              type: 'investment',
              current: 100000,
              currency: 'usd',
              as_of: '2026-11-15',
            },
          ],
        })}
        onComplete={() => {}}
      />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Portfolio value: $1,000.00');
      expect(lastFrame()).not.toContain('Cash:');
      expect(lastFrame()).not.toContain('Margin:');
    });
  });
});
