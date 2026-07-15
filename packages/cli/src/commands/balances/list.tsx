import type {
  Balance,
  BalancesPage,
  IBalancesResource,
  ListBalancesParams,
} from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useCallback } from 'react';
import { useAsyncAction } from '../../hooks/use-async-action';

interface BalancesListProps {
  resource: IBalancesResource;
  params?: ListBalancesParams;
  onComplete: (result: BalancesPage | null) => void;
}

const COLUMN_GAP = '  ';
const SOURCE_ID_MIN = 16;
const SOURCE_ID_MAX = 48;
const TYPE_WIDTH = 12;
const CURRENT_WIDTH = 15;
const CURRENCY_WIDTH = 8;

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

function formatCents(cents: number): string {
  const dollars = Math.abs(cents) / 100;
  const formatted = `$${dollars.toFixed(2)}`;
  return cents < 0 ? `-${formatted}` : formatted;
}

function sourceIdWidth(balances: Balance[]): number {
  if (balances.length === 0) return SOURCE_ID_MIN;
  const maxLen = Math.max(...balances.map((b) => (b.source_id ?? '').length));
  return Math.min(SOURCE_ID_MAX, Math.max(SOURCE_ID_MIN, maxLen));
}

export const BalancesList: React.FC<BalancesListProps> = ({
  resource,
  params,
  onComplete,
}) => {
  const action = useCallback(
    () => resource.listBalances(params),
    [resource, params],
  );
  const { status, data: page, error } = useAsyncAction(action, onComplete);
  const balances = page?.data ?? [];
  const nextCursor =
    page?.has_more && balances.length > 0
      ? balances[balances.length - 1].source_id
      : null;

  const idWidth = sourceIdWidth(balances);
  const headerRow = [
    formatCell('Source ID', idWidth),
    formatCell('Balance type', TYPE_WIDTH),
    formatCell('Current balance', CURRENT_WIDTH),
    formatCell('Currency', CURRENCY_WIDTH),
  ].join(COLUMN_GAP);
  const separatorRow = '-'.repeat(headerRow.length);
  const rows = balances.map((balance) =>
    [
      formatCell(balance.source_id ?? '-', idWidth),
      formatCell(balance.type ?? '-', TYPE_WIDTH),
      formatCell(
        balance.current != null ? formatCents(balance.current) : '-',
        CURRENT_WIDTH,
      ),
      formatCell(balance.currency ?? '-', CURRENCY_WIDTH),
    ].join(COLUMN_GAP),
  );

  if (status === 'loading') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" /> Loading balances...
        </Text>
      </Box>
    );
  }

  if (status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">Failed to load balances</Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  if (balances.length === 0) {
    return (
      <Box>
        <Text dimColor>No balances found</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Balances</Text>
      <Box flexDirection="column" marginTop={1} paddingX={2}>
        <Text bold>{headerRow}</Text>
        <Text dimColor>{separatorRow}</Text>
        {rows.map((row, index) => (
          <Text key={balances[index].source_id ?? `balance-${index}`}>
            {row}
          </Text>
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
