import type {
  ITransactionsResource,
  Transaction,
  UpdateTransactionParams,
} from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useCallback } from 'react';
import { useAsyncAction } from '../../hooks/use-async-action';
import { formatAmount } from '../../utils/format-amount';

interface TransactionUpdateProps {
  resource: ITransactionsResource;
  id: string;
  params: UpdateTransactionParams;
  onComplete: (result: Transaction | null) => void;
}

export const TransactionUpdate: React.FC<TransactionUpdateProps> = ({
  resource,
  id,
  params,
  onComplete,
}) => {
  const action = useCallback(
    () => resource.update(id, params),
    [resource, id, params],
  );
  const {
    status,
    data: transaction,
    error,
  } = useAsyncAction(action, onComplete);

  if (status === 'loading') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" /> Updating transaction {id}...
        </Text>
      </Box>
    );
  }

  if (status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ Failed to update transaction</Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="green">✓ Transaction updated</Text>
      <Box flexDirection="column" marginTop={1} paddingX={2}>
        <Text>
          ID: <Text bold>{transaction?.id}</Text>
        </Text>
        <Text>
          Description: <Text bold>{transaction?.description}</Text>
        </Text>
        <Text>
          Category: <Text bold>{transaction?.category}</Text>
        </Text>
        <Text>
          Amount:{' '}
          <Text bold>
            {transaction
              ? formatAmount(transaction.amount, transaction.currency)
              : 'N/A'}
          </Text>
        </Text>
        <Text>
          Date: <Text bold>{transaction?.created_date}</Text>
        </Text>
        <Text>
          Status: <Text bold>{transaction?.status}</Text>
        </Text>
      </Box>
    </Box>
  );
};
