import type { ISourcesResource, SourcesPage } from '@stripe/link-sdk';
import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sanitizeResource } from '../../../utils/resource-factory';
import { SourcesList } from '../list';

const ESCAPE_PAYLOAD = '\x1b[2JEvil\rHidden';
const CLEAN_TEXT = 'EvilHidden';

function makeResource(page: SourcesPage): ISourcesResource {
  return sanitizeResource({
    listSources: vi.fn(async () => page),
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
    setTerminalWidth(160);
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

  it('shows redaction dots for bank account sources with last4', async () => {
    setTerminalWidth(160);
    const resource = makeResource({
      data: [
        {
          id: 'csmrpd_1',
          name: 'Checking 1234',
          type: 'bank_account',
          bank_account: { bank_name: 'Chase', last4: '5678' },
        },
      ],
    });

    const { lastFrame } = render(
      <SourcesList resource={resource} onComplete={() => {}} />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('Chase ****5678');
      expect(frame).not.toContain('Checking 1234');
    });
  });

  it('shows redaction dots for card sources with last4', async () => {
    setTerminalWidth(160);
    const resource = makeResource({
      data: [
        {
          id: 'csmrpd_2',
          name: 'My Visa',
          type: 'card',
          card: { brand: 'Visa', last4: '4242' },
        },
      ],
    });

    const { lastFrame } = render(
      <SourcesList resource={resource} onComplete={() => {}} />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('Visa ****4242');
      expect(frame).not.toContain('My Visa');
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
});
