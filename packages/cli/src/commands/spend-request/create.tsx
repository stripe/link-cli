import type {
  CreateSpendRequestParams,
  ISpendRequestResource,
  SpendRequest,
} from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { AppDownloadQrCodes } from './app-download-qr-codes';
import { ApprovalWaitingView } from './approval-waiting-view';
import { useApprovalPolling } from './use-approval-polling';

interface CreateSpendRequestProps {
  repository: ISpendRequestResource;
  params: CreateSpendRequestParams;
  requestApproval?: boolean;
  onComplete: (result: SpendRequest | null) => void;
}

export const CreateSpendRequest: React.FC<CreateSpendRequestProps> = ({
  repository,
  params,
  requestApproval = false,
  onComplete,
}) => {
  const [status, setStatus] = useState<
    'creating' | 'waiting' | 'polling' | 'success' | 'error'
  >('creating');
  const [request, setRequest] = useState<SpendRequest | null>(null);
  const [error, setError] = useState<string>('');

  const approvalUrl = request?.approval_url ?? '';

  const onSuccess = useCallback(
    (result: SpendRequest) => setRequest(result),
    [],
  );
  const onError = useCallback((msg: string) => setError(msg), []);

  useApprovalPolling({
    status,
    setStatus,
    approvalUrl,
    repository,
    requestId: request?.id ?? null,
    onComplete,
    onSuccess,
    onError,
  });

  useEffect(() => {
    const create = async () => {
      try {
        const result = await repository.createSpendRequest(params);
        setRequest(result);

        if (requestApproval) {
          setStatus('waiting');
        } else {
          setStatus('success');
          setTimeout(() => onComplete(result), 1500);
        }
      } catch (err) {
        setError((err as Error).message);
        setStatus('error');
        setTimeout(() => onComplete(null), 1500);
      }
    };

    create();
  }, [repository, params, requestApproval, onComplete]);

  if (status === 'creating') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" /> Creating spend request...
        </Text>
      </Box>
    );
  }

  if (status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ Failed to create spend request</Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  if (status === 'success') {
    return (
      <Box flexDirection="column">
        <Text color="green">✓ Spend request created</Text>
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
              {request?.amount != null
                ? `${request.amount} ${request.currency?.toUpperCase() ?? ''}`.trim()
                : 'N/A'}
            </Text>
          </Text>
          <Text>
            Merchant: <Text bold>{request?.merchant_name}</Text>
          </Text>
          <Text>
            Line Items:{' '}
            <Text bold>
              {request?.line_items.map((li) => li.name).join(', ') || 'N/A'}
            </Text>
          </Text>
          {request?.credential_type === 'shared_payment_token' &&
            request.shared_payment_token && (
              <Text>
                Token: <Text bold>{request.shared_payment_token.id}</Text>
              </Text>
            )}
        </Box>
        <AppDownloadQrCodes />
      </Box>
    );
  }

  return (
    <>
      <Box>
        <Text color="green">
          ✓ Spend request created (ID: <Text bold>{request?.id}</Text>)
        </Text>
      </Box>
      <ApprovalWaitingView
        status={status as 'waiting' | 'polling'}
        approvalUrl={approvalUrl}
      />
    </>
  );
};
