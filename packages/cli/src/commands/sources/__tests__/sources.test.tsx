import type { ISourcesResource, SourcesPage } from '@stripe/link-sdk';
import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sanitizeResource } from '../../../utils/resource-factory';
import { SourcesList } from '../list';

const ESCAPE_PAYLOAD = '\x1b[2JEvil\rHidden';
const CLEAN_TEXT = 'EvilHidden';

function makeResource(page: SourcesPage): ISourcesResource {
  return sanitizeResource({
    list: vi.fn(async () => page),
  } as unknown as ISourcesResource);
}

function setTerminalWidth(columns: number) {
  Object.defineProperty(process.stdout, 'columns', {
    configurable: true,
    value: columns,
  });
}

describe('sources list component', () => {
  afterEach(() => {
    Object.defineProperty(process.stdout, 'columns', {
      configurable: true,
      value: undefined,
    });
  });

  it('renders source details', async () => {
    setTerminalWidth(200);
    const resource = makeResource({
      data: [
        {
          id: 'csmrpd_1',
          name: 'Checking 1234',
          type: 'bank_account',
          capabilities: {
            balances: { status: 'eligible' },
            transactions: { status: 'pending' },
          },
          external_connection: { status: 'active' },
        },
      ],
    });

    const { lastFrame } = render(
      <SourcesList resource={resource} onComplete={() => {}} />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('Name');
      expect(frame).toContain('Type');
      expect(frame).toContain('ID');
      expect(frame).toContain('Checking 1234');
      expect(frame).toContain('bank_account');
      expect(frame).toContain('csmrpd_1');
      expect(frame).toContain('balances:eligible');
      expect(frame).toContain('transactions');
      expect(frame).toContain('active');
    });
  });

  it('clips wide table columns in narrow terminals', async () => {
    setTerminalWidth(72);
    const resource = makeResource({
      data: [
        {
          id: 'csmrpd_1',
          name: 'Checking 1234',
          type: 'bank_account',
          capabilities: {
            transactions: { status: 'pending' },
          },
          external_connection: { status: 'active' },
        },
      ],
    });

    const { lastFrame } = render(
      <SourcesList resource={resource} onComplete={() => {}} />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('Checking 1234');
      expect(frame).toContain('Name');
      expect(frame).toContain('Type');
      expect(frame).toContain('ID');
      expect(frame).toContain('Capabi');
      expect(frame).not.toContain('Details');

      const tableLines = frame
        ?.split('\n')
        .map((line) => line.trimEnd())
        .filter((line) => line.trim().length > 0 && line !== 'Sources');
      expect(tableLines?.every((line) => line.length <= 72)).toBe(true);
    });
  });

  it('renders an empty state when there are no sources', async () => {
    const resource = makeResource({ data: [] });

    const { lastFrame } = render(
      <SourcesList resource={resource} onComplete={() => {}} />,
    );

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('No sources found');
    });
  });

  it('sanitizes escape sequences in source fields', async () => {
    const resource = makeResource({
      data: [
        {
          id: 'csmrpd_1',
          name: ESCAPE_PAYLOAD,
          type: ESCAPE_PAYLOAD,
        },
      ],
    });

    const { lastFrame } = render(
      <SourcesList resource={resource} onComplete={() => {}} />,
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
          id: 'csmrpd_2',
          name: 'Savings',
          type: 'bank_account',
        },
      ],
      has_more: true,
    });

    const { lastFrame } = render(
      <SourcesList resource={resource} onComplete={() => {}} />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('has_more: true');
      expect(frame).toContain('--starting-after csmrpd_2');
    });
  });

  it('preserves the baseline source frame byte-for-byte when category fields are omitted', async () => {
    setTerminalWidth(100);
    const resource = makeResource({
      data: [
        {
          id: 'csmrpd_1',
          name: 'Checking 1234',
          type: 'bank_account',
          capabilities: { balances: { status: 'eligible' } },
          external_connection: { status: 'active' },
        },
      ],
      has_more: false,
    });
    const { lastFrame } = render(
      <SourcesList resource={resource} onComplete={() => {}} />,
    );
    await vi.waitFor(() =>
      expect(lastFrame()).toBe(
        'Sources\n\n  Name                   Type            ID                       Capabilities     External con...\n  ------------------------------------------------------------------------------------------------\n  Checking 1234          bank_account    csmrpd_1                 balances:eli...  active\n\nhas_more: false',
      ),
    );
  });

  it.each([
    [
      { category: 'investment', subcategory: 'brokerage' },
      'Category: investment | Subcategory: brokerage',
    ],
    [
      { category: null, subcategory: null },
      'Category: unknown | Subcategory: unknown',
    ],
    [{ category: 'investment' }, 'Category: investment | Subcategory: -'],
  ])(
    'renders supplied source categories without inventing missing values: %j',
    async (metadata, expected) => {
      setTerminalWidth(120);
      const { lastFrame } = render(
        <SourcesList
          resource={makeResource({
            data: [{ id: 'csmrpd_1', name: 'Brokerage', ...metadata }],
          })}
          onComplete={() => {}}
        />,
      );
      await vi.waitFor(() => expect(lastFrame()).toContain(expected));
    },
  );
});
