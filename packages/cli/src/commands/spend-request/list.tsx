import type { ISpendRequestResource, SpendRequest } from '@stripe/link-sdk';
import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useCallback } from 'react';
import { useAsyncAction } from '../../hooks/use-async-action';

interface SpendRequestListProps {
  repository: ISpendRequestResource;
  includeHistory?: boolean;
  onComplete: (result: SpendRequest[] | null) => void;
}

export const SpendRequestList: React.FC<SpendRequestListProps> = ({
  repository,
  includeHistory = false,
  onComplete,
}) => {
  const { exit } = useApp();
  const action = useCallback(
    () => repository.listSpendRequests({ includeHistory }),
    [repository, includeHistory],
  );
  const wrappedOnComplete = useCallback(
    (result: SpendRequest[] | null) => {
      onComplete(result);
      exit();
    },
    [onComplete, exit],
  );
  const {
    status,
    data: requests,
    error,
  } = useAsyncAction(action, wrappedOnComplete);

  if (status === 'loading') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" /> Loading spend requests...
        </Text>
      </Box>
    );
  }

  if (status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ Failed to load spend requests</Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  if (!requests || requests.length === 0) {
    return (
      <Box>
        <Text dimColor>
          {includeHistory
            ? 'No spend requests found'
            : 'No active spend requests found'}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>
        {includeHistory ? 'All Spend Requests' : 'Active Spend Requests'}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {requests.map((sr) => {
          const statusColor =
            sr.status === 'approved'
              ? 'green'
              : sr.status === 'pending_approval'
                ? 'yellow'
                : 'white';
          const amount =
            sr.amount != null
              ? `$${(sr.amount / 100).toFixed(2)} ${(sr.currency ?? 'usd').toUpperCase()}`
              : '';
          return (
            <Box key={sr.id} paddingX={2}>
              <Text>
                <Text dimColor>{sr.id}</Text>
                {'  '}
                <Text color={statusColor}>{sr.status}</Text>
                {sr.merchant_name ? `  ${sr.merchant_name}` : ''}
                {amount ? `  ${amount}` : ''}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};
