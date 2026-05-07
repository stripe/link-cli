import type {
  ISpendRequestResource,
  SpendRequest,
  UpdateSpendRequestParams,
} from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useCallback } from 'react';
import { useAsyncAction } from '../../hooks/use-async-action';

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
  const action = useCallback(
    () => repository.updateSpendRequest(id, params),
    [repository, id, params],
  );
  const { status, data: request, error } = useAsyncAction(action, onComplete);

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
