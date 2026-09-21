import type {
  ISummariesResource,
  SummariesPage,
  Summary,
} from '@stripe/link-sdk';
import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sanitizeResource } from '../../../utils/resource-factory';
import { SummariesList } from '../list';

const ESCAPE_PAYLOAD = '\x1b[2JEvil\rText';

function summary(overrides: Partial<Summary> = {}): Summary {
  return {
    id: 'sum_1',
    description: 'Your recent activity',
    created_at: '2026-09-15T18:30:00Z',
    status: 'ready',
    entries: [
      { label: 'Payments', value: { unit: 'count', count: 1234 } },
      {
        label: 'Payment volume',
        value: { unit: 'payment_volume', amount: 12345, currency: 'usd' },
      },
    ],
    ...overrides,
  };
}

function makeResource(pages: SummariesPage[]): ISummariesResource {
  return sanitizeResource({
    list: vi.fn(async () => pages.shift() ?? { data: [] }),
  } as unknown as ISummariesResource);
}

describe('summaries list component', () => {
  afterEach(() => vi.restoreAllMocks());

  it('groups ready and pending summaries in the requested interactive format', async () => {
    const { lastFrame } = render(
      <SummariesList
        resource={makeResource([
          {
            data: [
              summary({
                description:
                  'Top 5 brands in your transaction history in the last 180 days based on the amount of money spent (as of 2026-09-14)',
                entries: [
                  {
                    label: 'Marine Layer',
                    value: {
                      unit: 'payment_volume',
                      amount: 15000,
                      currency: 'usd',
                    },
                  },
                  {
                    label: 'Whole Foods',
                    value: {
                      unit: 'payment_volume',
                      amount: 5000,
                      currency: 'usd',
                    },
                  },
                ],
              }),
              summary({
                id: 'sum_2',
                description:
                  'Top 5 brands in your transaction history in the last 90 days based on the number of transactions (as of 2026-09-14)',
                entries: [
                  {
                    label: 'Marine Layer',
                    value: { unit: 'count', count: 12 },
                  },
                  {
                    label: 'Whole Foods',
                    value: { unit: 'count', count: 8 },
                  },
                ],
              }),
              summary({
                id: 'sum_3',
                description:
                  'An aggregation that takes Stripe hours to compute.',
                status: 'pending',
                entries: [],
              }),
            ],
            has_more: false,
          },
        ])}
        onComplete={() => {}}
      />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame() ?? '';
      const normalizedFrame = frame.replace(/\s+/g, ' ');
      expect(normalizedFrame).toContain('Summaries');
      expect(normalizedFrame).toContain(
        'Top 5 brands in your transaction history in the last 180 days based on the amount of money spent (as of 2026-09-14)',
      );
      expect(normalizedFrame).toContain('1. Marine Layer (USD 150.00)');
      expect(normalizedFrame).toContain('2. Whole Foods (USD 50.00)');
      expect(normalizedFrame).toContain(
        'Top 5 brands in your transaction history in the last 90 days based on the number of transactions (as of 2026-09-14)',
      );
      expect(normalizedFrame).toContain('1. Marine Layer (12)');
      expect(normalizedFrame).toContain('2. Whole Foods (8)');
      expect(normalizedFrame).toContain(
        'Data were not ready yet for these summaries; check again later:',
      );
      expect(normalizedFrame).toContain(
        '1. An aggregation that takes Stripe hours to compute.',
      );
    });
  });

  it('formats count values without a unit suffix', async () => {
    const { lastFrame } = render(
      <SummariesList
        resource={makeResource([{ data: [summary()], has_more: false }])}
        onComplete={() => {}}
      />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('Your recent activity');
      expect(frame).toContain('1. Payments (1,234)');
      expect(frame).toContain('2. Payment volume (USD 123.45)');
    });
  });

  it('renders the live ready summary title with as-of date and indented data row', async () => {
    const liveReadySummary = {
      id: 'sum_live_123',
      description: 'Your recent activity',
      status: 'ready',
      entries: [],
      as_of: 1726358400,
      data: [
        { label: 'Payments', value: { unit: 'count', amount: 1 } },
        { label: 'Refunds', value: { unit: 'count', amount: 2 } },
      ],
    } as unknown as Summary;
    const { lastFrame } = render(
      <SummariesList
        resource={makeResource([{ data: [liveReadySummary] }])}
        onComplete={() => {}}
      />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Your recent activity (as of Sep 15, 2024)');
      expect(frame).not.toContain('\nAs of Sep 15, 2024');
      expect(frame).toContain('\n  1. Payments (1)');
      expect(frame).toContain('\n  2. Refunds (2)');
    });
  });

  it('renders no-data summaries separately from pending summaries', async () => {
    const { lastFrame } = render(
      <SummariesList
        resource={makeResource([
          {
            data: [summary({ status: 'no_data', entries: [] })],
          },
        ])}
        onComplete={() => {}}
      />,
    );

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('No data is available for this summary');
      expect(lastFrame()).not.toContain(
        'Data were not ready yet for these summaries',
      );
    });
  });

  it('renders an empty state', async () => {
    const { lastFrame } = render(
      <SummariesList
        resource={makeResource([{ data: [] }])}
        onComplete={() => {}}
      />,
    );
    await vi.waitFor(() => expect(lastFrame()).toContain('No summaries found'));
  });

  it('omits the timestamp when the API does not provide one', async () => {
    const { lastFrame } = render(
      <SummariesList
        resource={makeResource([
          { data: [summary({ created_at: undefined })] },
        ])}
        onComplete={() => {}}
      />,
    );

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Your recent activity');
      expect(lastFrame()).not.toContain('Invalid Date');
      expect(lastFrame()).not.toContain('null');
    });
  });

  it('renders an error state when loading summaries fails', async () => {
    const resource = sanitizeResource({
      list: vi.fn(async () => {
        throw new Error('network unavailable');
      }),
    } as unknown as ISummariesResource);
    const { lastFrame } = render(
      <SummariesList resource={resource} onComplete={() => {}} />,
    );

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Failed to load summaries');
      expect(lastFrame()).toContain('network unavailable');
    });
  });

  it('sanitizes terminal escape sequences at the resource boundary', async () => {
    const { lastFrame } = render(
      <SummariesList
        resource={makeResource([
          {
            data: [
              summary({ description: ESCAPE_PAYLOAD, id: ESCAPE_PAYLOAD }),
            ],
          },
        ])}
        onComplete={() => {}}
      />,
    );

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('EvilText');
      expect(lastFrame()).not.toContain('\x1b[2J');
      expect(lastFrame()).not.toContain('\r');
    });
  });

  it('keeps cards legible in a narrow terminal', async () => {
    const columns = process.stdout.columns;
    Object.defineProperty(process.stdout, 'columns', {
      configurable: true,
      value: 30,
    });
    const { lastFrame } = render(
      <SummariesList
        resource={makeResource([{ data: [summary()] }])}
        onComplete={() => {}}
      />,
    );

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Your recent activity');
      expect(lastFrame()).toContain('Payments');
    });
    Object.defineProperty(process.stdout, 'columns', {
      configurable: true,
      value: columns,
    });
  });
});
