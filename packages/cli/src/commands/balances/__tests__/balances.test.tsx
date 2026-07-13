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
          name: 'Checking 1234',
          type: 'bank_account',
          available: { amount: 12500, currency: 'usd' },
          current: { amount: 13000, currency: 'usd' },
        },
      ],
    });

    const { lastFrame } = render(
      <BalancesList resource={resource} onComplete={() => {}} />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('Source');
      expect(frame).toContain('Type');
      expect(frame).toContain('ID');
      expect(frame).toContain('Available');
      expect(frame).toContain('Current');
      expect(frame).toContain('Checking 1234');
      expect(frame).toContain('bank_account');
      expect(frame).toContain('csmrpd_1');
      expect(frame).toContain('12500 usd');
      expect(frame).toContain('13000 usd');
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
          source_id: 'csmrpd_1',
          name: ESCAPE_PAYLOAD,
          type: ESCAPE_PAYLOAD,
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
          name: 'Savings',
          type: 'bank_account',
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
