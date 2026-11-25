import type { TaxLotsPage } from '@stripe/link-sdk';
import { LinkApiError } from '@stripe/link-sdk';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { sanitizeResource } from '../../../utils/resource-factory';
import { TaxLotsList } from '../list';

const lot = {
  id: 'fclot_1',
  purchased_date: '2026-01-15',
  cost_basis: null,
  quantity: 0.25,
};
describe('tax-lots list component', () => {
  it('returns one page with a purchased date and an explicit next-page hint', async () => {
    const page: TaxLotsPage = { data: [lot], has_more: true };
    const list = vi.fn(async () => page);
    const onComplete = vi.fn();
    const { lastFrame } = render(
      <TaxLotsList
        resource={sanitizeResource({ list })}
        params={{ holding: 'fchold_1' }}
        onComplete={onComplete}
      />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Purchased date: 2026-01-15');
      expect(lastFrame()).toContain('Quantity: 0.25');
      expect(lastFrame()).toContain('Cost basis: unknown');
      expect(lastFrame()).toContain('next page: --starting-after fclot_1');
    });
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledWith(page), {
      timeout: 2000,
    });
    expect(list).toHaveBeenCalledOnce();
  });
  it.each([
    {
      direction: 'default forward',
      params: { holding: 'fchold_1' },
      hint: 'next page: --starting-after fclot_last',
    },
    {
      direction: 'explicit forward',
      params: { holding: 'fchold_1', starting_after: 'fclot_before' },
      hint: 'next page: --starting-after fclot_last',
    },
    {
      direction: 'backward',
      params: { holding: 'fchold_1', ending_before: 'fclot_after' },
      hint: 'next page: --ending-before fclot_first',
    },
    {
      direction: 'backward with an empty cursor',
      params: { holding: 'fchold_1', ending_before: '' },
      hint: 'next page: --ending-before fclot_first',
    },
  ])(
    'continues $direction pagination from its page boundary',
    async ({ params, hint }) => {
      const page: TaxLotsPage = {
        data: [
          { ...lot, id: 'fclot_first' },
          { ...lot, id: 'fclot_last' },
        ],
        has_more: true,
      };
      const list = vi.fn(async () => page);
      const { lastFrame } = render(
        <TaxLotsList
          resource={sanitizeResource({ list })}
          params={params}
          onComplete={() => {}}
        />,
      );
      await vi.waitFor(() => expect(lastFrame()).toContain(hint));
      expect(list).toHaveBeenCalledOnce();
      expect(list).toHaveBeenCalledWith(params);
    },
  );
  it.each([0, 12345])(
    'renders numeric cost basis %s without inventing currency',
    async (cost_basis) => {
      const { lastFrame } = render(
        <TaxLotsList
          resource={{
            list: vi.fn(async () => ({
              data: [{ ...lot, cost_basis }],
              has_more: false,
            })),
          }}
          params={{ holding: 'fchold_1' }}
          onComplete={() => {}}
        />,
      );
      await vi.waitFor(() => {
        expect(lastFrame()).toContain(`Cost basis: ${cost_basis}`);
        expect(lastFrame()).not.toContain('$');
        expect(lastFrame()).not.toContain('unknown');
        expect(lastFrame()).not.toContain('next page:');
      });
    },
  );
  it.each([false, true])(
    'shows an empty page without a cursor when has_more is %s',
    async (has_more) => {
      const { lastFrame } = render(
        <TaxLotsList
          resource={{ list: vi.fn(async () => ({ data: [], has_more })) }}
          params={{ holding: 'fchold_1' }}
          onComplete={() => {}}
        />,
      );
      await vi.waitFor(() => {
        expect(lastFrame()).toContain('No tax lots found');
        expect(lastFrame()).toContain(`has_more: ${has_more}`);
        expect(lastFrame()).not.toContain('next page:');
      });
    },
  );
  it('sanitizes fields and quotes hostile cursor hints', async () => {
    const { lastFrame } = render(
      <TaxLotsList
        resource={sanitizeResource({
          list: vi.fn(async () => ({
            data: [
              {
                ...lot,
                id: 'fclot_$(printf PWNED)',
                purchased_date: '\x1b[2J2026-01-15\r',
              },
            ],
            has_more: true,
          })),
        })}
        params={{ holding: 'fchold_1' }}
        onComplete={() => {}}
      />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Purchased date: 2026-01-15');
      expect(lastFrame()).toContain(
        "next page: --starting-after 'fclot_$(printf PWNED)'",
      );
      expect(lastFrame()).not.toContain('\x1b[2J');
      expect(lastFrame()).not.toContain('\r');
    });
  });
  it('quotes a hostile first-row cursor for backward pagination', async () => {
    const list = vi.fn(async () => ({
      data: [
        { ...lot, id: 'fclot_$(printf PWNED)' },
        { ...lot, id: 'fclot_last' },
      ],
      has_more: true,
    }));
    const { lastFrame } = render(
      <TaxLotsList
        resource={sanitizeResource({ list })}
        params={{ holding: 'fchold_1', ending_before: 'fclot_after' }}
        onComplete={() => {}}
      />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain(
        "next page: --ending-before 'fclot_$(printf PWNED)'",
      );
    });
    expect(list).toHaveBeenCalledOnce();
  });
  it('shows permission remediation through the shared safe helper', async () => {
    const error = new LinkApiError('PRIVATE_PAYLOAD', {
      status: 403,
      details: {
        error: {
          code: 'missing_permissions',
          message: '\x1b[2JAccess\rdenied',
          authorization_remediation: {
            authorization_details: [
              { type: 'source', actions: ['read_holdings'] },
            ],
          },
        },
      },
    });
    const list = vi.fn(async () => {
      throw error;
    });
    const { lastFrame } = render(
      <TaxLotsList
        resource={{ list }}
        params={{ holding: 'fchold_1' }}
        onComplete={() => {}}
      />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Accessdenied');
      expect(lastFrame()).toContain(
        'Upgrade access: link-cli auth upgrade --source-actions read_holdings',
      );
      expect(lastFrame()).not.toContain('PRIVATE_PAYLOAD');
    });
    expect(list).toHaveBeenCalledOnce();
  });
});
