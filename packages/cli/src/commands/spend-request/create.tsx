import type {
  CreateSpendRequestParams,
  ISpendRequestResource,
  NextAction,
  SpendRequest,
} from '@stripe/link-sdk';
import { LinkApiError, getDuplicateSpendRequest } from '@stripe/link-sdk';
import { Box, Text, useApp, useInput } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import {
  DISPLAY_DELAY_MS,
  RESUME_POLL_INTERVAL_MS,
  RESUME_TIMEOUT_MS,
} from '../../utils/constants';
import { writeCredentialFile } from '../../utils/credential-output';
import { formatAmount } from '../../utils/format-amount';
import { openUrl } from '../../utils/open-url';
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
  const { exit } = useApp();

  const [status, setStatus] = useState<
    | 'creating'
    | 'waiting'
    | 'polling'
    | 'success'
    | 'error'
    | 'verification_required'
    | 'opened'
    | 'requires_action'
    | 'resuming'
    | 'resume_timeout'
  >('creating');
  const [request, setRequest] = useState<SpendRequest | null>(null);
  const [duplicateRequest, setDuplicateRequest] = useState<SpendRequest | null>(
    null,
  );
  const [error, setError] = useState<string>('');
  const [verificationUrl, setVerificationUrl] = useState<string>('');
  const [supportUrl, setSupportUrl] = useState<string>('');
  const [countdown, setCountdown] = useState(30);
  const [outputFilePath, setOutputFilePath] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string>('');
  const [nextAction, setNextAction] = useState<NextAction | null>(null);

  const approvalUrl = request?.approval_url ?? '';

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
  const onRequiresAction = useCallback((result: SpendRequest) => {
    setRequest(result);
    setNextAction(result.status_details?.requires_action?.next_action ?? null);
  }, []);

  useApprovalPolling({
    status,
    setStatus,
    approvalUrl,
    repository,
    requestId: request?.id ?? null,
    onComplete: completeAndExit,
    onSuccess,
    onError,
    onRequiresAction,
  });

  useInput(
    (_input, key) => {
      if (key.return && nextAction?.action_url) {
        openUrl(nextAction.action_url);
        completeAndExit(request);
      }
    },
    {
      isActive:
        status === 'requires_action' &&
        nextAction?.resolution !== 'auto_resume',
    },
  );

  useEffect(() => {
    if (status !== 'requires_action') return;
    if (nextAction?.resolution === 'auto_resume') {
      setStatus('resuming');
    }
  }, [status, nextAction]);

  useEffect(() => {
    if (status !== 'resuming' || !request?.id) return;

    let cancelled = false;
    const requestId = request.id;
    const deadline = Date.now() + RESUME_TIMEOUT_MS;

    const poll = async () => {
      while (!cancelled) {
        if (Date.now() > deadline) {
          setStatus('resume_timeout');
          setTimeout(() => completeAndExit(request), DISPLAY_DELAY_MS);
          return;
        }

        await new Promise((r) => setTimeout(r, RESUME_POLL_INTERVAL_MS));
        if (cancelled) return;

        let latest: SpendRequest | null;
        try {
          latest = await repository.getSpendRequest(requestId);
        } catch {
          continue;
        }
        if (cancelled || !latest) continue;

        setRequest(latest);
        if (latest.status === 'requires_action') continue;

        if (latest.status === 'approved' || latest.status === 'succeeded') {
          setStatus('success');
        } else {
          setError(
            `Spend request did not resolve after 3D Secure (status: ${latest.status})`,
          );
          setStatus('error');
        }
        setTimeout(() => completeAndExit(latest), DISPLAY_DELAY_MS);
        return;
      }
    };

    poll();
    return () => {
      cancelled = true;
    };
  }, [status, request, repository, completeAndExit]);

  useInput((_, key) => {
    if (
      key.return &&
      (verificationUrl || supportUrl) &&
      status === 'verification_required'
    ) {
      openUrl(verificationUrl || supportUrl);
      setStatus('opened');
      setTimeout(() => completeAndExit(null), DISPLAY_DELAY_MS);
    }
  });

  useEffect(() => {
    if (status !== 'verification_required') return;
    if (countdown <= 0) {
      completeAndExit(null);
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [status, countdown, completeAndExit]);

  useEffect(() => {
    if (status !== 'requires_action') return;
    if (nextAction?.resolution === 'auto_resume') return;
    if (countdown <= 0) {
      completeAndExit(request);
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [status, nextAction, countdown, completeAndExit, request]);

  useEffect(() => {
    const create = async () => {
      try {
        const result = await repository.createSpendRequest(params);
        setRequest(result);

        if (result.status === 'requires_action') {
          setNextAction(
            result.status_details?.requires_action?.next_action ?? null,
          );
          setStatus('requires_action');
        } else if (requestApproval) {
          setStatus('waiting');
        } else {
          setStatus('success');
          setTimeout(() => completeAndExit(result), DISPLAY_DELAY_MS);
        }
      } catch (err) {
        setError((err as Error).message);
        if (err instanceof LinkApiError) {
          const errDetail = err.details as {
            error?: { verification_url?: string; support_url?: string };
          };
          if (errDetail?.error?.verification_url)
            setVerificationUrl(errDetail.error.verification_url);
          if (errDetail?.error?.support_url)
            setSupportUrl(errDetail.error.support_url);
          if (
            errDetail?.error?.verification_url ||
            errDetail?.error?.support_url
          ) {
            setStatus('verification_required');
            return;
          }
          const duplicate = getDuplicateSpendRequest(err);
          if (duplicate) setDuplicateRequest(sanitizeDeep(duplicate));
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

  if (status === 'verification_required') {
    const url = verificationUrl || supportUrl;
    return (
      <Box flexDirection="column">
        <Text color="red">✗ Failed to create spend request</Text>
        <Text color="red">{error}</Text>
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="cyan"
          paddingX={2}
          paddingY={1}
          marginTop={1}
        >
          <Text>
            Open:{' '}
            <Text bold color="cyan">
              {url}
            </Text>
          </Text>
          <Text dimColor>Press Enter to open in browser</Text>
          <Text dimColor>Exiting in {countdown}s...</Text>
        </Box>
      </Box>
    );
  }

  if (status === 'opened') {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ Failed to create spend request</Text>
        <Text color="red">{error}</Text>
        <Text color="green">✓ Opened verification URL in browser</Text>
      </Box>
    );
  }

  if (status === 'requires_action') {
    return (
      <Box flexDirection="column">
        <Text color="yellow">⚠ Action required before payment can proceed</Text>
        <Box flexDirection="column" marginTop={1} paddingX={2}>
          <Text>
            ID: <Text bold>{request?.id}</Text>
          </Text>
          <Text>
            Type: <Text bold>{nextAction?.type}</Text>
          </Text>
          <Text>{nextAction?.display_message}</Text>
        </Box>
        {nextAction?.action_url && (
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor="cyan"
            paddingX={2}
            paddingY={1}
            marginTop={1}
          >
            <Text>
              Open:{' '}
              <Text bold color="cyan">
                {nextAction.action_url}
              </Text>
            </Text>
            <Text dimColor>Press Enter to open in browser</Text>
            <Text dimColor>Exiting in {countdown}s...</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>
            Complete this step, then create a new spend request.
          </Text>
        </Box>
      </Box>
    );
  }

  if (status === 'resuming') {
    return (
      <Box flexDirection="column">
        <Text color="cyan">
          <Spinner type="dots" /> Waiting for 3D Secure verification to
          complete...
        </Text>
        <Box flexDirection="column" marginTop={1} paddingX={2}>
          <Text>{nextAction?.display_message}</Text>
          {nextAction?.action_url && (
            <Text dimColor>
              URL: <Text color="cyan">{nextAction.action_url}</Text>
            </Text>
          )}
        </Box>
      </Box>
    );
  }

  if (status === 'resume_timeout') {
    return (
      <Box flexDirection="column">
        <Text color="yellow">
          ✗ Timed out waiting for 3D Secure verification to resolve
        </Text>
        <Text dimColor>
          Run `spend-request retrieve {request?.id}` to check the current
          status.
        </Text>
      </Box>
    );
  }

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
        {duplicateRequest && (
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor="yellow"
            paddingX={2}
            paddingY={1}
            marginTop={1}
          >
            <Text bold color="yellow">
              A matching spend request already exists
            </Text>
            <Box flexDirection="column" marginTop={1}>
              <Text>
                ID: <Text bold>{duplicateRequest.id}</Text>
              </Text>
              <Text>
                Status: <Text bold>{duplicateRequest.status}</Text>
              </Text>
              <Text>
                Amount:{' '}
                <Text bold>
                  {duplicateRequest.amount != null
                    ? formatAmount(
                        duplicateRequest.amount,
                        duplicateRequest.currency ?? '',
                      )
                    : 'N/A'}
                </Text>
              </Text>
              <Text>
                Merchant: <Text bold>{duplicateRequest.merchant_name}</Text>
              </Text>
            </Box>
            {duplicateRequest.status !== 'expired' &&
              duplicateRequest.status !== 'canceled' &&
              duplicateRequest.status !== 'failed' && (
                <>
                  <Text dimColor>
                    {'\n'}Retrieve it to resume instead of creating a new one:
                  </Text>
                  <Text color="cyan">
                    spend-request retrieve {duplicateRequest.id}
                  </Text>
                </>
              )}
          </Box>
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
                ? formatAmount(request.amount, request.currency ?? '')
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
