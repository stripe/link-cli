import type {
  CreateSpendRequestParams,
  ISpendRequestResource,
  SpendRequest,
} from '@stripe/link-sdk';
import { LinkApiError } from '@stripe/link-sdk';
import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { DISPLAY_DELAY_MS } from '../../utils/constants';
import { writeCredentialFile } from '../../utils/credential-output';
import { AppDownloadQrCodes } from './app-download-qr-codes';
import { ApprovalWaitingView } from './approval-waiting-view';
import { useApprovalPolling } from './use-approval-polling';

interface CreateSpendRequestProps {
  repository: ISpendRequestResource;
  params: CreateSpendRequestParams;
  requestApproval?: boolean;
  outputFile?: string;
  force?: boolean;
  onComplete: (result: SpendRequest | null) => void;
}

export const CreateSpendRequest: React.FC<CreateSpendRequestProps> = ({
  repository,
  params,
  requestApproval = false,
  outputFile,
  force,
  onComplete,
}) => {
  const [status, setStatus] = useState<
    'creating' | 'waiting' | 'polling' | 'success' | 'error'
  >('creating');
  const [request, setRequest] = useState<SpendRequest | null>(null);
  const [error, setError] = useState<string>('');
  const [verificationUrl, setVerificationUrl] = useState<string>('');
  const [outputFilePath, setOutputFilePath] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string>('');

  const approvalUrl = request?.approval_url ?? '';
  const { exit } = useApp();

  const completeAndExit = useCallback(
    (result: SpendRequest | null) => {
      onComplete(result);
      exit();
    },
    [onComplete, exit],
  );

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
    onComplete: completeAndExit,
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
          setTimeout(() => completeAndExit(result), DISPLAY_DELAY_MS);
        }
      } catch (err) {
        setError((err as Error).message);
        if (err instanceof LinkApiError) {
          const url = (err.details as { error?: { verification_url?: string } })
            ?.error?.verification_url;
          if (url) setVerificationUrl(url);
        }
        setStatus('error');
        setTimeout(() => completeAndExit(null), DISPLAY_DELAY_MS);
      }
    };

    create();
  }, [repository, params, requestApproval, completeAndExit]);

  useEffect(() => {
    if (status !== 'success' || !outputFile || !request?.card) return;

    const fileData = {
      spend_request_id: request.id,
      merchant_name: request.merchant_name,
      merchant_url: request.merchant_url,
      context: request.context,
      created_at: request.created_at,
      card: request.card,
    };
    writeCredentialFile(outputFile, fileData, force ?? false)
      .then((path) => setOutputFilePath(path))
      .catch((err) => setFileError((err as Error).message));
  }, [status, outputFile, force, request]);

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
        {verificationUrl && (
          <Text color="red">
            Complete additional verification at: {verificationUrl}
          </Text>
        )}
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
        {request?.card && !outputFile && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Card Details:</Text>
            <Text>
              {' '}
              Number: <Text bold>{request.card.number}</Text>
            </Text>
            <Text>
              {' '}
              Brand: <Text bold>{request.card.brand}</Text>
            </Text>
            <Text>
              {' '}
              Expiry:{' '}
              <Text bold>
                {String(request.card.exp_month).padStart(2, '0')}/
                {request.card.exp_year}
              </Text>
            </Text>
            {request.card.cvc && (
              <Text>
                {' '}
                CVC: <Text bold>{request.card.cvc}</Text>
              </Text>
            )}
            {request.card.valid_until && (
              <Text>
                {' '}
                Valid Until: <Text bold>{request.card.valid_until}</Text>
              </Text>
            )}
          </Box>
        )}
        {request?.card && outputFile && (
          <Box flexDirection="column" marginTop={1}>
            {outputFilePath && (
              <Text color="green">
                Card credentials written to <Text bold>{outputFilePath}</Text>
              </Text>
            )}
            {fileError && (
              <Text color="red">Failed to write card file: {fileError}</Text>
            )}
          </Box>
        )}
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
