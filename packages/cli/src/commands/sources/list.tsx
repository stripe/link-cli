import type {
  ISourcesResource,
  ListSourcesParams,
  Source,
  SourcesPage,
} from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useCallback } from 'react';
import { useAsyncAction } from '../../hooks/use-async-action';

interface SourcesListProps {
  resource: ISourcesResource;
  params?: ListSourcesParams;
  onComplete: (result: SourcesPage | null) => void;
}

const COLUMN_GAP = '  ';
const HORIZONTAL_PADDING = 4;

interface SourceRow {
  key: string;
  name: string;
  type: string;
  id: string;
  capabilities: string;
  external: string;
}

interface TableColumn {
  label: string;
  value: (row: SourceRow) => string;
  minWidth: number;
  maxWidth: number;
}

function truncateCell(value: string, width: number): string {
  if (value.length <= width) {
    return value;
  }

  if (width <= 3) {
    return value.slice(0, width);
  }

  return `${value.slice(0, width - 3)}...`;
}

function formatCell(value: string, width: number): string {
  return truncateCell(value, width).padEnd(width);
}

function sourceId(source: Source, index: number): string {
  return typeof source.id === 'string' && source.id.length > 0
    ? source.id
    : `source-${index + 1}`;
}

function statusFromValue(value: unknown): string | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const status = (value as Record<string, unknown>).status;
    return typeof status === 'string' ? status : null;
  }
  return null;
}

function formatCapabilities(source: Source): string {
  const capabilities = source.capabilities;
  if (!capabilities || typeof capabilities !== 'object') {
    return '-';
  }

  const entries = Object.entries(capabilities)
    .map(([capability, value]) => {
      const status = statusFromValue(value);
      return status ? `${capability}:${status}` : capability;
    })
    .sort();

  return entries.length > 0 ? entries.join(', ') : '-';
}

function formatExternalConnection(source: Source): string {
  const status = statusFromValue(source.external_connection);
  return status ?? '-';
}

function sourceRow(source: Source, index: number): SourceRow {
  const capabilities = formatCapabilities(source);
  const external = formatExternalConnection(source);

  return {
    key: sourceId(source, index),
    name: source.name ?? 'Source',
    type: source.type ?? '-',
    id: sourceId(source, index),
    capabilities,
    external,
  };
}

function tableColumns(): TableColumn[] {
  return [
    { label: 'Name', value: (row) => row.name, minWidth: 14, maxWidth: 24 },
    { label: 'Type', value: (row) => row.type, minWidth: 10, maxWidth: 14 },
    { label: 'ID', value: (row) => row.id, minWidth: 16, maxWidth: 48 },
    {
      label: 'Capabilities',
      value: (row) => row.capabilities,
      minWidth: 8,
      maxWidth: 48,
    },
    {
      label: 'External connection status',
      value: (row) => row.external,
      minWidth: 8,
      maxWidth: 36,
    },
  ];
}

function distributeWidths(
  columns: TableColumn[],
  availableWidth: number,
): number[] {
  const gapWidth = COLUMN_GAP.length * Math.max(0, columns.length - 1);
  const contentWidth = Math.max(columns.length, availableWidth - gapWidth);
  const widths = columns.map((column) => column.minWidth);
  let remaining =
    contentWidth - widths.reduce((total, width) => total + width, 0);

  while (remaining > 0) {
    let changed = false;

    for (let index = 0; index < columns.length && remaining > 0; index += 1) {
      if (widths[index] >= columns[index].maxWidth) {
        continue;
      }

      widths[index] += 1;
      remaining -= 1;
      changed = true;
    }

    if (!changed) {
      break;
    }
  }

  return widths;
}

function renderTableRows(rows: SourceRow[], terminalWidth: number) {
  const columns = tableColumns();
  const availableWidth = contentWidth(terminalWidth);
  const widths = distributeWidths(columns, availableWidth);
  const headerRow = columns
    .map((column, index) => formatCell(column.label, widths[index]))
    .join(COLUMN_GAP)
    .slice(0, availableWidth);
  const separatorRow = '-'.repeat(headerRow.length).slice(0, availableWidth);
  const bodyRows = rows.map((row) =>
    columns
      .map((column, index) => formatCell(column.value(row), widths[index]))
      .join(COLUMN_GAP)
      .slice(0, availableWidth),
  );

  return { headerRow, separatorRow, bodyRows };
}

function contentWidth(terminalWidth: number): number {
  return Math.max(1, terminalWidth - HORIZONTAL_PADDING);
}

export const SourcesList: React.FC<SourcesListProps> = ({
  resource,
  params,
  onComplete,
}) => {
  const action = useCallback(
    () => resource.listSources(params),
    [resource, params],
  );
  const { status, data: page, error } = useAsyncAction(action, onComplete);
  const sources = page?.data ?? [];
  const nextCursor =
    page?.has_more && sources.length > 0
      ? sources[sources.length - 1].id
      : null;
  const rows = sources.map(sourceRow);
  const terminalWidth = process.stdout.columns ?? 140;
  const { headerRow, separatorRow, bodyRows } = renderTableRows(
    rows,
    terminalWidth,
  );

  if (status === 'loading') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" /> Loading sources...
        </Text>
      </Box>
    );
  }

  if (status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">Failed to load sources</Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  if (sources.length === 0) {
    return (
      <Box>
        <Text dimColor>No sources found</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Sources</Text>
      <Box flexDirection="column" marginTop={1} paddingX={2}>
        <Text bold>{headerRow}</Text>
        <Text dimColor>{separatorRow}</Text>
        {bodyRows.map((row, index) => (
          <Text key={rows[index].key}>{row}</Text>
        ))}
      </Box>
      {page?.has_more !== undefined ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>has_more: {String(page.has_more)}</Text>
          {typeof nextCursor === 'string' && nextCursor.length > 0 ? (
            <Text dimColor>{`next page: --starting-after ${nextCursor}`}</Text>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
};
