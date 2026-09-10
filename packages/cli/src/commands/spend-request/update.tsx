import type {
  ISpendRequestResource,
  SpendRequest,
  UpdateSpendRequestParams,
} from '@stripe/link-sdk';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useCallback, useState } from 'react';
import { useAsyncAction } from '../../hooks/use-async-action';
import { openUrl } from '../../utils/open-url';
import {
  type SpendRequestUpdatePollResult,
  pollUntilSpendRequestUpdate,
} from '../../utils/poll-until-spend-request-update';
import { ApprovalWaitingView } from './approval-waiting-view';

interface UpdateSpendRequestProps {
  repository: ISpendRequestResource;
  id: string;
  params: UpdateSpendRequestParams;
  onComplete: (result: SpendRequest | null) => void;
}

type UpdateResult =
  | SpendRequestUpdatePollResult
  | {
      request: SpendRequest;
      outcome: 'updated';
    };

export const UpdateSpendRequest: React.FC<UpdateSpendRequestProps> = ({
  repository,
  id,
  params,
  onComplete,
}) => {
  const [pendingApproval, setPendingApproval] = useState<SpendRequest | null>(
    null,
  );

  const action = useCallback(async (): Promise<UpdateResult> => {
    const request = await repository.update(id, params);
    if (
      params.amount !== undefined &&
      request.status === 'approved' &&
      request.approval_url
    ) {
      setPendingApproval(request);
      return pollUntilSpendRequestUpdate(repository, id, params.amount);
    }
    return { request, outcome: 'updated' };
  }, [repository, id, params]);

  const handleComplete = useCallback(
    (result: UpdateResult | null) => onComplete(result?.request ?? null),
    [onComplete],
  );
  const {
    status,
    data: result,
    error,
  } = useAsyncAction(action, handleComplete);
  const request = result?.request ?? pendingApproval;

  useInput(
    (_input, key) => {
      if (key.return && pendingApproval?.approval_url) {
        openUrl(pendingApproval.approval_url);
      }
    },
    { isActive: status === 'loading' && pendingApproval !== null },
  );

  if (status === 'loading') {
    if (pendingApproval?.approval_url) {
      return (
        <ApprovalWaitingView
          status="polling"
          approvalUrl={pendingApproval.approval_url}
        />
      );
    }
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

  if (result?.outcome === 'denied') {
    return (
      <Box flexDirection="column">
        <Text color="yellow">✗ Spend request update denied</Text>
        <Box flexDirection="column" marginTop={1} paddingX={2}>
          <Text>
            ID: <Text bold>{request?.id}</Text>
          </Text>
          <Text>
            Amount: <Text bold>{request?.amount ?? 'N/A'}</Text>
          </Text>
        </Box>
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
            {request?.amount !== undefined ? String(request.amount) : 'N/A'}
          </Text>
        </Text>
        <Text>
          Merchant: <Text bold>{request?.merchant_name}</Text>
        </Text>
        <Text>
          Line Items:{' '}
          <Text bold>
            {request?.line_items?.map((li) => li.name).join(', ') || 'N/A'}
          </Text>
        </Text>
      </Box>
    </Box>
  );
};
