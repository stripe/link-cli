import type {
  ITransactionsResource,
  ListTransactionsParams,
  TransactionsPage,
} from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useCallback } from 'react';
import { useAsyncAction } from '../../hooks/use-async-action';

interface TransactionsListProps {
  resource: ITransactionsResource;
  params?: ListTransactionsParams;
  onComplete: (result: TransactionsPage | null) => void;
}

const COLUMN_GAP = '  ';
const DATE_WIDTH = 10;
const AMOUNT_WIDTH = 13;
const STATUS_WIDTH = 10;
const CATEGORY_WIDTH = 16;
const MIN_DESCRIPTION_WIDTH = 16;
const HORIZONTAL_PADDING = 4;

function formatAmount(amount: number, currency: string): string {
  const currencyCode = currency.toUpperCase();

  try {
    const formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode,
    });
    const fractionDigits =
      formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(amount / 10 ** fractionDigits);
  } catch {
    return `${amount} ${currency}`;
  }
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

function formatCell(
  value: string,
  width: number,
  align: 'left' | 'right' = 'left',
): string {
  const truncated = truncateCell(value, width);
  return align === 'right'
    ? truncated.padStart(width)
    : truncated.padEnd(width);
}

export const TransactionsList: React.FC<TransactionsListProps> = ({
  resource,
  params,
  onComplete,
}) => {
  const action = useCallback(
    () => resource.listTransactions(params),
    [resource, params],
  );
  const { status, data: page, error } = useAsyncAction(action, onComplete);
  const transactions = page?.data ?? [];
  const nextCursor =
    page?.has_more && transactions.length > 0
      ? transactions[transactions.length - 1].id
      : null;
  const terminalWidth = process.stdout.columns ?? 100;
  const descriptionWidth = Math.max(
    MIN_DESCRIPTION_WIDTH,
    terminalWidth -
      HORIZONTAL_PADDING -
      DATE_WIDTH -
      AMOUNT_WIDTH -
      STATUS_WIDTH -
      CATEGORY_WIDTH -
      COLUMN_GAP.length * 4,
  );

  const headerRow = [
    formatCell('Date', DATE_WIDTH),
    formatCell('Amount', AMOUNT_WIDTH, 'right'),
    formatCell('Status', STATUS_WIDTH),
    formatCell('Category', CATEGORY_WIDTH),
    formatCell('Description', descriptionWidth),
  ].join(COLUMN_GAP);
  const separatorRow = '-'.repeat(headerRow.length);
  const rows = transactions.map((txn) =>
    [
      formatCell(txn.created_date, DATE_WIDTH),
      formatCell(formatAmount(txn.amount, txn.currency), AMOUNT_WIDTH, 'right'),
      formatCell(txn.status, STATUS_WIDTH),
      formatCell(txn.category ?? '', CATEGORY_WIDTH),
      formatCell(txn.description, descriptionWidth),
    ].join(COLUMN_GAP),
  );

  if (status === 'loading') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" /> Loading transactions...
        </Text>
      </Box>
    );
  }

  if (status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">Failed to load transactions</Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  if (transactions.length === 0) {
    return (
      <Box>
        <Text dimColor>No transactions found</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Transactions</Text>
      <Box flexDirection="column" marginTop={1} paddingX={2}>
        <Text bold>{headerRow}</Text>
        <Text dimColor>{separatorRow}</Text>
        {rows.map((row, index) => (
          <Text key={transactions[index].id}>{row}</Text>
        ))}
      </Box>
      {page?.has_more !== undefined ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>has_more: {String(page.has_more)}</Text>
          {nextCursor ? (
            <Text dimColor>{`next page: --starting-after ${nextCursor}`}</Text>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
};
