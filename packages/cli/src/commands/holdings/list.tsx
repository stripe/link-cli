import type {
  HoldingsPage,
  IHoldingsResource,
  ListHoldingsParams,
} from '@stripe/link-sdk';
import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import { useCallback } from 'react';
import { useAsyncAction } from '../../hooks/use-async-action';
import { formatAmount } from '../../utils/format-amount';
import { investmentApiError } from '../../utils/investment-api-error';
import { sanitizeText } from '../../utils/sanitize-text';
import { posixShellQuote } from '../../utils/shell-quote';

interface HoldingsListProps {
  resource: IHoldingsResource;
  params: ListHoldingsParams;
  onComplete: (page: HoldingsPage | null) => void;
  onError?: (error: unknown) => void;
}

export function HoldingsList({
  resource,
  params,
  onComplete,
  onError,
}: HoldingsListProps) {
  const { exit } = useApp();
  const action = useCallback(async () => {
    try {
      return await resource.list(params);
    } catch (error) {
      onError?.(error);
      const details = investmentApiError(error, 'list holdings');
      const message =
        details?.message ??
        sanitizeText(
          error instanceof Error ? error.message : 'Failed to load holdings',
        );
      const command = details?.cta?.commands[0]?.command;
      throw new Error(
        command ? `${message}\nUpgrade access: link-cli ${command}` : message,
      );
    }
  }, [resource, params, onError]);
  const {
    status,
    data: page,
    error,
  } = useAsyncAction<HoldingsPage>(action, (result) => {
    onComplete(result);
    exit();
  });
  if (status === 'loading')
    return (
      <Text color="cyan">
        <Spinner type="dots" /> Loading holdings...
      </Text>
    );
  if (status === 'error')
    return (
      <Box flexDirection="column">
        <Text color="red">Failed to load holdings</Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  const holdings = page?.data ?? [];
  const isBackward = params.ending_before !== undefined;
  const nextId = isBackward ? holdings[0]?.id : holdings.at(-1)?.id;
  const nextCursorOption = isBackward ? '--ending-before' : '--starting-after';
  return (
    <Box flexDirection="column">
      <Text bold>Holdings</Text>
      {holdings.length === 0 ? (
        <Text dimColor>No holdings found</Text>
      ) : (
        holdings.map((holding) => (
          <Box key={holding.id} flexDirection="column" marginTop={1}>
            <Text>
              {holding.security_name ?? 'unknown'}
              {holding.ticker_symbol ? ` (${holding.ticker_symbol})` : ''}
            </Text>
            <Text>Description: {holding.description ?? 'unknown'}</Text>
            <Text dimColor>
              ID: {holding.id} | Source: {holding.source_id}
            </Text>
            <Text>
              Quantity: {holding.quantity} | Type: {holding.type} | Position:{' '}
              {holding.position_type}
            </Text>
            <Text>
              Market value:{' '}
              {Object.entries(holding.total_market_value)
                .map(([currency, amount]) => formatAmount(amount, currency))
                .join(', ') || 'unknown'}
            </Text>
            <Text dimColor>
              Snapshot date: {holding.as_of_date ?? 'unknown'}
            </Text>
          </Box>
        ))
      )}
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>has_more: {String(page?.has_more ?? false)}</Text>
        {page?.has_more && nextId ? (
          <Text dimColor>
            next page: {nextCursorOption} {posixShellQuote(nextId)}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}
