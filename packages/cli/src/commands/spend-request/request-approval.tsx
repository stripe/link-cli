import type {
  ISpendRequestResource,
  NextAction,
  SpendRequest,
} from '@stripe/link-sdk';
import { LinkApiError } from '@stripe/link-sdk';
import { Box, Text, useApp, useInput } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { DISPLAY_DELAY_MS } from '../../utils/constants';
import { openUrl } from '../../utils/open-url';
import { ApprovalWaitingView } from './approval-waiting-view';
import { useApprovalPolling } from './use-approval-polling';

interface RequestApprovalProps {
  repository: ISpendRequestResource;
  id: string;
  onComplete: (result: SpendRequest | null) => void;
}

export const RequestApproval: React.FC<RequestApprovalProps> = ({
  repository,
  id,
  onComplete,
}) => {
  const { exit } = useApp();

  const completeAndExit = useCallback(
    (result: SpendRequest | null) => {
      onComplete(result);
      exit();
    },
    [onComplete, exit],
  );

  const [status, setStatus] = useState<
    | 'requesting'
    | 'waiting'
    | 'polling'
    | 'success'
    | 'error'
    | 'verification_required'
    | 'opened'
    | 'requires_action'
  >('requesting');
  const [approvalUrl, setApprovalUrl] = useState<string>('');
  const [result, setResult] = useState<SpendRequest | null>(null);
  const [error, setError] = useState<string>('');
  const [verificationUrl, setVerificationUrl] = useState<string>('');
  const [supportUrl, setSupportUrl] = useState<string>('');
  const [countdown, setCountdown] = useState(30);
  const [nextAction, setNextAction] = useState<NextAction | null>(null);

  const onSuccess = useCallback((r: SpendRequest) => setResult(r), []);
  const onError = useCallback((msg: string) => setError(msg), []);
  const onRequiresAction = useCallback((r: SpendRequest) => {
    setResult(r);
    setNextAction(r.status_details?.requires_action?.next_action ?? null);
  }, []);

  useApprovalPolling({
    status,
    setStatus,
    approvalUrl,
    repository,
    requestId: id,
    onComplete: completeAndExit,
    onSuccess,
    onError,
    onRequiresAction,
  });

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
    const request = async () => {
      try {
        const res = await repository.requestApproval(id);
        setApprovalUrl(res.approval_link);
        setStatus('waiting');
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
        }
        setStatus('error');
        setTimeout(() => {
          onComplete(null);
          exit();
        }, DISPLAY_DELAY_MS);
      }
    };

    request();
  }, [repository, id, onComplete, exit]);

  if (status === 'verification_required') {
    const url = verificationUrl || supportUrl;
    return (
      <Box flexDirection="column">
        <Text color="red">✗ Failed to request approval</Text>
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
        <Text color="red">✗ Failed to request approval</Text>
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
            ID: <Text bold>{result?.id}</Text>
          </Text>
          <Text>{nextAction?.display_message}</Text>
          {nextAction?.action_url && (
            <Text>
              URL: <Text color="cyan">{nextAction.action_url}</Text>
            </Text>
          )}
        </Box>
      </Box>
    );
  }

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
