import type { BalancesPage, IBalancesResource } from '@stripe/link-sdk';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { sanitizeResource } from '../../../utils/resource-factory';
import { BalancesList } from '../list';

const ESCAPE_PAYLOAD = '\x1b[2JEvil\rHidden';
const CLEAN_TEXT = 'EvilHidden';

function makeResource(page: BalancesPage): IBalancesResource {
  return sanitizeResource({
    listBalances: vi.fn(async () => page),
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
});
