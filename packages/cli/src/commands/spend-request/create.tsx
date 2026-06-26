import type {
  CreateSpendRequestParams,
  ISpendRequestResource,
  SpendRequest,
} from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useEffect, useState } from 'react';
import { DISPLAY_DELAY_MS } from '../../utils/constants';
import { writeCredentialFile } from '../../utils/credential-output';
import { tryStartCallbackServer } from '../../utils/local-callback-server';
import { sanitizeDeep } from '../../utils/sanitize-text';
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
    | 'creating'
    | 'waiting'
    | 'polling'
    | 'success'
    | 'denied'
    | 'expired'
    | 'error'
  >('creating');
  const [request, setRequest] = useState<SpendRequest | null>(null);
  const [approvalUrl, setApprovalUrl] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [outputFilePath, setOutputFilePath] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string>('');
  const [pollingFallback, setPollingFallback] = useState(false);

  useApprovalPolling({
    enabled: pollingFallback,
    status,
    setStatus: () => setStatus('polling'),
    approvalUrl,
    repository,
    requestId: request?.id ?? null,
    onComplete,
    onTerminal: (final, s) => {
      setRequest(sanitizeDeep(final));
      if (s === 'approved') {
        setStatus('success');
      } else if (s === 'denied') {
        setStatus('denied');
      } else if (s === 'expired') {
        setStatus('expired');
      } else {
        setError('An error occurred during approval');
        setStatus('error');
      }
    },
    onPollError: (msg) => {
      setError(msg);
      setStatus('error');
    },
  });

  useEffect(() => {
    let close: (() => void) | null = null;
    let cancelled = false;

    const create = async () => {
      try {
        const server = requestApproval ? await tryStartCallbackServer() : null;
        if (server) close = server.close;

        // Strip request_approval so the spend request starts in `created` state; we call requestApproval explicitly below.
        const { request_approval: _, ...createParams } = params;
        const result = await repository.createSpendRequest(createParams);
        if (cancelled) return;
        setRequest(sanitizeDeep(result));

        if (!requestApproval) {
          setStatus('success');
          setTimeout(() => onComplete(result), DISPLAY_DELAY_MS);
          return;
        }

        const approval = await repository.requestApproval(
          result.id,
          server ? { redirect_uri: server.redirectUri } : undefined,
        );
        if (cancelled) return;

        setApprovalUrl(sanitizeDeep(approval.approval_link));
        setStatus('waiting');

        if (!server) {
          setPollingFallback(true);
          return;
        }

        const { status: callbackStatus } = await server.waitForCallback();
        if (cancelled) return;

        if (callbackStatus === 'timeout') {
          setPollingFallback(true);
          return;
        }

        const final = await repository.retrieve(result.id);
        if (cancelled) return;

        if (!final) {
          setError('Spend request not found after approval');
          setStatus('error');
          setTimeout(() => onComplete(null), DISPLAY_DELAY_MS);
          return;
        }

        setRequest(sanitizeDeep(final));
        if (callbackStatus === 'approved') {
          setStatus('success');
        } else if (callbackStatus === 'denied') {
          setStatus('denied');
        } else if (callbackStatus === 'expired') {
          setStatus('expired');
        } else {
          setError('An error occurred during approval');
          setStatus('error');
        }
        setTimeout(() => onComplete(final), DISPLAY_DELAY_MS);
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
          setStatus('error');
          setTimeout(() => onComplete(null), DISPLAY_DELAY_MS);
        }
      } finally {
        close?.();
      }
    };

    create();
    return () => {
      cancelled = true;
      close?.();
    };
  }, [repository, params, requestApproval, onComplete]);

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
      </Box>
    );
  }

  if (status === 'denied') {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ Spend request denied</Text>
        <Box flexDirection="column" marginTop={1} paddingX={2}>
          <Text>
            ID: <Text bold>{request?.id}</Text>
          </Text>
          <Text>
            Status:{' '}
            <Text bold color="red">
              {request?.status}
            </Text>
          </Text>
        </Box>
      </Box>
    );
  }

  if (status === 'expired') {
    return (
      <Box flexDirection="column">
        <Text color="yellow">✗ Spend request expired</Text>
        <Box flexDirection="column" marginTop={1} paddingX={2}>
          <Text>
            ID: <Text bold>{request?.id}</Text>
          </Text>
          <Text>
            Status: <Text bold>{request?.status}</Text>
          </Text>
        </Box>
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
      <ApprovalWaitingView approvalUrl={approvalUrl} />
    </>
  );
};
