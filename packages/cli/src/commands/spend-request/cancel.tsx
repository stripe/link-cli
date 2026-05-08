import type { ISpendRequestResource, SpendRequest } from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useCallback } from 'react';
import { useAsyncAction } from '../../hooks/use-async-action';

interface CancelSpendRequestProps {
  repository: ISpendRequestResource;
  id: string;
  onComplete: (result: SpendRequest | null) => void;
}

export const CancelSpendRequest: React.FC<CancelSpendRequestProps> = ({
  repository,
  id,
  onComplete,
}) => {
  const action = useCallback(
    () => repository.cancelSpendRequest(id),
    [repository, id],
  );
  const { status, data: request, error } = useAsyncAction(action, onComplete);

  if (status === 'loading') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" /> Canceling spend request {id}...
        </Text>
      </Box>
    );
  }

  if (status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ Failed to cancel spend request</Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="green">✓ Spend request canceled</Text>
      <Box flexDirection="column" marginTop={1} paddingX={2}>
        <Text>
          ID: <Text bold>{request?.id}</Text>
        </Text>
      </Box>
    </Box>
  );
};
