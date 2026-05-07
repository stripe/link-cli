import type { ISpendRequestResource, SpendRequest } from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useEffect, useState } from 'react';

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
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>(
    'loading',
  );
  const [request, setRequest] = useState<SpendRequest | null>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const run = async () => {
      try {
        const result = await repository.cancelSpendRequest(id);
        setRequest(result);
        setStatus('success');
        setTimeout(() => onComplete(result), 1500);
      } catch (err) {
        setError((err as Error).message);
        setStatus('error');
        setTimeout(() => onComplete(null), 1500);
      }
    };

    run();
  }, [repository, id, onComplete]);

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
