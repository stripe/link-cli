import type { ISpendRequestResource, SpendRequest } from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { ApprovalWaitingView } from './approval-waiting-view';
import { useApprovalPolling } from './use-approval-polling';

interface RequestApprovalProps {
  repository: ISpendRequestResource;
  id: string;
  onComplete: (result: SpendRequest) => void;
}

export const RequestApproval: React.FC<RequestApprovalProps> = ({
  repository,
  id,
  onComplete,
}) => {
  const [status, setStatus] = useState<
    'requesting' | 'waiting' | 'polling' | 'success' | 'error'
  >('requesting');
  const [approvalUrl, setApprovalUrl] = useState<string>('');
  const [result, setResult] = useState<SpendRequest | null>(null);
  const [error, setError] = useState<string>('');

  const onSuccess = useCallback((r: SpendRequest) => setResult(r), []);
  const onError = useCallback((msg: string) => setError(msg), []);

  useApprovalPolling({
    status,
    setStatus,
    approvalUrl,
    repository,
    requestId: id,
    onComplete,
    onSuccess,
    onError,
  });

  useEffect(() => {
    const request = async () => {
      try {
        const res = await repository.requestApproval(id);
        setApprovalUrl(res.approval_link);
        setStatus('waiting');
      } catch (err) {
        setError((err as Error).message);
        setStatus('error');
      }
    };

    request();
  }, [repository, id]);

  if (status === 'requesting') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" /> Requesting approval...
        </Text>
      </Box>
    );
  }

  if (status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ Failed to request approval</Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  if (status === 'success') {
    return (
      <Box flexDirection="column">
        <Text color="green">✓ Approval completed</Text>
        <Box flexDirection="column" marginTop={1} paddingX={2}>
          <Text>
            ID: <Text bold>{result?.id}</Text>
          </Text>
          <Text>
            Status: <Text bold>{result?.status}</Text>
          </Text>
          <Text>
            Amount:{' '}
            <Text bold>
              {result?.amount != null
                ? `${result.amount} ${result.currency?.toUpperCase() ?? ''}`.trim()
                : 'N/A'}
            </Text>
          </Text>
          <Text>
            Merchant: <Text bold>{result?.merchant_name}</Text>
          </Text>
          {result?.credential_type === 'shared_payment_token' &&
            result.shared_payment_token && (
              <Text>
                Token: <Text bold>{result.shared_payment_token.id}</Text>
              </Text>
            )}
        </Box>
      </Box>
    );
  }

  return (
    <ApprovalWaitingView
      status={status as 'waiting' | 'polling'}
      approvalUrl={approvalUrl}
    />
  );
};
