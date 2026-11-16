import type {
  Holding,
  HoldingsPage,
  IHoldingsResource,
} from '@stripe/link-sdk';
import { LinkApiError } from '@stripe/link-sdk';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { sanitizeResource } from '../../../utils/resource-factory';
import { HoldingsList } from '../list';

const holding: Holding = {
  id: 'fchold_1',
  source_id: 'csmrpd_1',
  description: null,
  security_name: null,
  total_market_value: { usd: 12500 },
  quantity: 0.25,
  as_of_date: null,
  position_type: 'long',
  type: 'crypto',
};
function makeResource(page: HoldingsPage) {
  return sanitizeResource({
    list: vi.fn(async () => page),
  } as IHoldingsResource);
}

describe('holdings list component', () => {
  it('shows sparse snapshots, crypto, and a next-page hint after one request', async () => {
    const list = vi.fn(async () => ({ data: [holding], has_more: true }));
    const resource = sanitizeResource({ list });
    const onComplete = vi.fn();
    const { lastFrame } = render(
      <HoldingsList
        resource={resource}
        params={{ source: 'csmrpd_1' }}
        onComplete={onComplete}
      />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Description: unknown');
      expect(lastFrame()).toContain('Snapshot date: unknown');
      expect(lastFrame()).toContain('Quantity: 0.25');
      expect(lastFrame()).toContain('Type: crypto');
      expect(lastFrame()).toContain('Market value: $125.00');
      expect(lastFrame()).toContain('next page: --starting-after fchold_1');
    });
    await vi.waitFor(
      () =>
        expect(onComplete).toHaveBeenCalledWith({
          data: [holding],
          has_more: true,
        }),
      { timeout: 2000 },
    );
    expect(list).toHaveBeenCalledOnce();
  });
  it.each([
    {
      direction: 'default forward',
      params: { source: 'csmrpd_1' },
      hint: 'next page: --starting-after fchold_last',
    },
    {
      direction: 'explicit forward',
      params: { source: 'csmrpd_1', starting_after: 'fchold_before' },
      hint: 'next page: --starting-after fchold_last',
    },
    {
      direction: 'backward',
      params: { source: 'csmrpd_1', ending_before: 'fchold_after' },
      hint: 'next page: --ending-before fchold_first',
    },
    {
      direction: 'backward with an empty cursor',
      params: { source: 'csmrpd_1', ending_before: '' },
      hint: 'next page: --ending-before fchold_first',
    },
  ])(
    'continues $direction pagination from its page boundary',
    async ({ params, hint }) => {
      const page = {
        data: [
          { ...holding, id: 'fchold_first' },
          { ...holding, id: 'fchold_last' },
        ],
        has_more: true,
      };
      const list = vi.fn(async () => page);
      const resource = sanitizeResource({ list });
      const { lastFrame } = render(
        <HoldingsList
          resource={resource}
          params={params}
          onComplete={() => {}}
        />,
      );
      await vi.waitFor(() => expect(lastFrame()).toContain(hint));
      expect(list).toHaveBeenCalledOnce();
      expect(list).toHaveBeenCalledWith(params);
    },
  );
  it.each([false, true])(
    'shows an empty page without a cursor when has_more is %s',
    async (has_more) => {
      const resource = makeResource({ data: [], has_more });
      const { lastFrame } = render(
        <HoldingsList
          resource={resource}
          params={{ source: 'csmrpd_1' }}
          onComplete={() => {}}
        />,
      );
      await vi.waitFor(() => {
        expect(lastFrame()).toContain('No holdings found');
        expect(lastFrame()).toContain(`has_more: ${has_more}`);
        expect(lastFrame()).not.toContain('next page:');
      });
    },
  );
  it('omits the next-page hint on a final nonempty page', async () => {
    const resource = makeResource({ data: [holding], has_more: false });
    const { lastFrame } = render(
      <HoldingsList
        resource={resource}
        params={{ source: 'csmrpd_1', ending_before: 'fchold_after' }}
        onComplete={() => {}}
      />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('has_more: false');
      expect(lastFrame()).not.toContain('next page:');
    });
  });
  it('sanitizes descriptions and quotes a hostile next cursor', async () => {
    const resource = makeResource({
      data: [
        {
          ...holding,
          id: 'fchold_$(printf PWNED)',
          description: '\x1b[2JHidden\rText',
          security_name: 'Future',
          as_of_date: '2026-11-15',
          type: 'future',
        },
      ],
      has_more: true,
    });
    const { lastFrame } = render(
      <HoldingsList
        resource={resource}
        params={{ source: 'csmrpd_1' }}
        onComplete={() => {}}
      />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Description: HiddenText');
      expect(lastFrame()).toContain('Snapshot date: 2026-11-15');
      expect(lastFrame()).toContain(
        "next page: --starting-after 'fchold_$(printf PWNED)'",
      );
      expect(lastFrame()).not.toContain('\x1b[2J');
      expect(lastFrame()).not.toContain('\r');
    });
  });
  it('quotes a hostile first-row cursor for backward pagination', async () => {
    const resource = makeResource({
      data: [
        { ...holding, id: 'fchold_$(printf PWNED)' },
        { ...holding, id: 'fchold_last' },
      ],
      has_more: true,
    });
    const { lastFrame } = render(
      <HoldingsList
        resource={resource}
        params={{ source: 'csmrpd_1', ending_before: 'fchold_after' }}
        onComplete={() => {}}
      />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain(
        "next page: --ending-before 'fchold_$(printf PWNED)'",
      );
    });
  });
  it('shows sanitized permission remediation without initiating auth', async () => {
    const error = new LinkApiError('raw-body-secret', {
      status: 403,
      rawBody: 'raw-body-secret',
      details: {
        error: {
          code: 'missing_permissions',
          message: '\x1b[2JRead\rDenied',
          authorization_remediation: {
            authorization_details: [
              { type: 'source', actions: ['read_holdings'] },
            ],
          },
        },
      },
    });
    const resource = {
      list: vi.fn(async () => {
        throw error;
      }),
    };
    const onError = vi.fn();
    const { lastFrame } = render(
      <HoldingsList
        resource={resource}
        params={{ source: 'csmrpd_1' }}
        onComplete={() => {}}
        onError={onError}
      />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('ReadDenied');
      expect(lastFrame()).toContain(
        'Upgrade access: link-cli auth upgrade --source-actions read_holdings',
      );
      expect(lastFrame()).not.toContain('raw-body-secret');
      expect(lastFrame()).not.toContain('\x1b[2J');
    });
    expect(resource.list).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(error);
  });
});
