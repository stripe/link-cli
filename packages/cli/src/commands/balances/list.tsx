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
const SOURCE_WIDTH = 13;
const TYPE_WIDTH = 12;
const ID_WIDTH = 15;
const AVAILABLE_WIDTH = 12;
const CURRENT_WIDTH = 12;
const CURRENCY_WIDTH = 6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

function formatScalar(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function getNested(balance: Balance, key: string): unknown {
  if (balance[key] !== undefined) {
    return balance[key];
  }

  const balances = balance.balances;
  if (isRecord(balances) && balances[key] !== undefined) {
    return balances[key];
  }

  return undefined;
}

function formatAmountValue(value: unknown, fallbackCurrency?: string): string {
  const scalar = formatScalar(value);
  if (scalar) {
    return fallbackCurrency ? `${scalar} ${fallbackCurrency}` : scalar;
  }

  if (!isRecord(value)) {
    return '-';
  }

  const amount = formatScalar(value.amount);
  if (!amount) {
    return '-';
  }

  const currency = formatScalar(value.currency) ?? fallbackCurrency;
  return currency ? `${amount} ${currency}` : amount;
}

function formatAmount(balance: Balance, primaryKey: string): string {
  const fallbackCurrency = formatScalar(balance.currency) ?? undefined;
  const candidates = [
    primaryKey,
    `${primaryKey}_balance`,
    primaryKey === 'available' ? 'available_balance' : 'current_balance',
  ];

  for (const key of candidates) {
    const value = getNested(balance, key);
    if (value !== undefined && value !== null) {
      return formatAmountValue(value, fallbackCurrency);
    }
  }

  return '-';
}

function sourceRecord(balance: Balance): Record<string, unknown> | null {
  return isRecord(balance.source) ? balance.source : null;
}

function sourceName(balance: Balance): string {
  const source = sourceRecord(balance);
  return (
    formatScalar(balance.name) ??
    (source ? formatScalar(source.name) : null) ??
    'Source'
  );
}

function sourceType(balance: Balance): string {
  const source = sourceRecord(balance);
  return (
    formatScalar(balance.type) ??
    (source ? formatScalar(source.type) : null) ??
    '-'
  );
}

function balanceId(balance: Balance, index: number): string {
  const source = sourceRecord(balance);
  return (
    formatScalar(balance.source_id) ??
    (source ? formatScalar(source.id) : null) ??
    formatScalar(balance.id) ??
    `balance-${index + 1}`
  );
}

function currency(balance: Balance): string {
  if (formatScalar(balance.currency)) {
    return formatScalar(balance.currency) ?? '-';
  }

  for (const key of ['available', 'current', 'amount']) {
    const value = getNested(balance, key);
    if (isRecord(value) && formatScalar(value.currency)) {
      return formatScalar(value.currency) ?? '-';
    }
  }

  return '-';
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
      ? balanceId(balances[balances.length - 1], balances.length - 1)
      : null;

  const headerRow = [
    formatCell('Source', SOURCE_WIDTH),
    formatCell('Type', TYPE_WIDTH),
    formatCell('ID', ID_WIDTH),
    formatCell('Available', AVAILABLE_WIDTH),
    formatCell('Current', CURRENT_WIDTH),
    formatCell('Currency', CURRENCY_WIDTH),
  ].join(COLUMN_GAP);
  const separatorRow = '-'.repeat(headerRow.length);
  const rows = balances.map((balance, index) =>
    [
      formatCell(sourceName(balance), SOURCE_WIDTH),
      formatCell(sourceType(balance), TYPE_WIDTH),
      formatCell(balanceId(balance, index), ID_WIDTH),
      formatCell(formatAmount(balance, 'available'), AVAILABLE_WIDTH),
      formatCell(formatAmount(balance, 'current'), CURRENT_WIDTH),
      formatCell(currency(balance), CURRENCY_WIDTH),
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
          <Text key={balanceId(balances[index], index)}>{row}</Text>
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
