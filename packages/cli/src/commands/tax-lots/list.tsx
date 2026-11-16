import type {
  ITaxLotsResource,
  ListTaxLotsParams,
  TaxLotsPage,
} from '@stripe/link-sdk';
import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import { useCallback } from 'react';
import { useAsyncAction } from '../../hooks/use-async-action';
import { investmentApiError } from '../../utils/investment-api-error';
import { sanitizeText } from '../../utils/sanitize-text';
import { posixShellQuote } from '../../utils/shell-quote';

interface TaxLotsListProps {
  resource: ITaxLotsResource;
  params: ListTaxLotsParams;
  onComplete: (page: TaxLotsPage | null) => void;
  onError?: (error: unknown) => void;
}
export function TaxLotsList({
  resource,
  params,
  onComplete,
  onError,
}: TaxLotsListProps) {
  const { exit } = useApp();
  const action = useCallback(async () => {
    try {
      return await resource.list(params);
    } catch (error) {
      onError?.(error);
      const details = investmentApiError(error, 'list tax lots');
      const message =
        details?.message ??
        sanitizeText(
          error instanceof Error ? error.message : 'Failed to load tax lots',
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
  } = useAsyncAction<TaxLotsPage>(action, (result) => {
    onComplete(result);
    exit();
  });
  if (status === 'loading')
    return (
      <Text color="cyan">
        <Spinner type="dots" /> Loading tax lots...
      </Text>
    );
  if (status === 'error')
    return (
      <Box flexDirection="column">
        <Text color="red">Failed to load tax lots</Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  const lots = page?.data ?? [];
  const isBackward = params.ending_before !== undefined;
  const nextId = isBackward ? lots[0]?.id : lots.at(-1)?.id;
  const nextCursorOption = isBackward ? '--ending-before' : '--starting-after';
  return (
    <Box flexDirection="column">
      <Text bold>Tax lots</Text>
      {lots.length === 0 ? (
        <Text dimColor>No tax lots found</Text>
      ) : (
        lots.map((lot) => (
          <Box key={lot.id} flexDirection="column" marginTop={1}>
            <Text>ID: {lot.id}</Text>
            <Text>Purchased date: {lot.purchased_date}</Text>
            <Text>Quantity: {lot.quantity}</Text>
            <Text>Cost basis: {lot.cost_basis ?? 'unknown'}</Text>
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
