import type {
  ISpendRequestResource,
  SpendRequest,
  UpdateSpendRequestParams,
} from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useEffect, useState } from 'react';

interface UpdateSpendRequestProps {
  repository: ISpendRequestResource;
  id: string;
  params: UpdateSpendRequestParams;
  onComplete: (result: SpendRequest | null) => void;
}

export const UpdateSpendRequest: React.FC<UpdateSpendRequestProps> = ({
  repository,
  id,
  params,
  onComplete,
}) => {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>(
    'loading',
  );
  const [request, setRequest] = useState<SpendRequest | null>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const update = async () => {
      try {
        const result = await repository.updateSpendRequest(id, params);
        setRequest(result);
        setStatus('success');
        setTimeout(() => onComplete(result), 1500);
      } catch (err) {
        setError((err as Error).message);
        setStatus('error');
        setTimeout(() => onComplete(null), 1500);
      }
    };

    update();
  }, [repository, id, params, onComplete]);

  if (status === 'loading') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" /> Updating spend request {id}...
        </Text>
      </Box>
    );
  }

  if (status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ Failed to update spend request</Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="green">✓ Spend request updated</Text>
      <Box flexDirection="column" marginTop={1} paddingX={2}>
        <Text>
          ID: <Text bold>{request?.id}</Text>
        </Text>
        <Text>
          Status: <Text bold>{request?.status}</Text>
        </Text>
        <Text>
          Amount:{' '}
          <Text bold>
            {(() => {
              const t = request?.totals.find((t) => t.type === 'total');
              return t ? String(t.amount) : 'N/A';
            })()}
          </Text>
        </Text>
        <Text>
          Merchant: <Text bold>{request?.merchant_name}</Text>
        </Text>
        <Text>
          Line Items:{' '}
          <Text bold>
            {request?.line_items.map((li) => li.name).join(', ')}
          </Text>
        </Text>
      </Box>
    </Box>
  );
};
