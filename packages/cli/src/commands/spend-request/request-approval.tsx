import type { ISpendRequestResource, SpendRequest } from '@stripe/link-sdk';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useEffect, useState } from 'react';
import { DISPLAY_DELAY_MS } from '../../utils/constants';
import { startCallbackServer } from '../../utils/local-callback-server';
import { openUrl } from '../../utils/open-url';
import { ApprovalWaitingView } from './approval-waiting-view';

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
    'requesting' | 'waiting' | 'success' | 'error'
  >('requesting');
  const [approvalUrl, setApprovalUrl] = useState<string>('');
  const [result, setResult] = useState<SpendRequest | null>(null);
  const [error, setError] = useState<string>('');

  useInput(
    (_input, key) => {
      if (key.return && approvalUrl) openUrl(approvalUrl);
    },
    { isActive: status === 'waiting' },
  );

  useEffect(() => {
    let close: (() => void) | null = null;
    let cancelled = false;

    const run = async () => {
      try {
        const server = await startCallbackServer();
        close = server.close;

        const res = await repository.requestApproval(id, {
          redirect_uri: server.redirectUri,
        });
        if (cancelled) return;

        setApprovalUrl(res.approval_link);
        setStatus('waiting');

        const { approved } = await server.waitForCallback();
        if (cancelled) return;

        const final = await repository.retrieve(id);
        if (cancelled) return;

        if (!final) {
          setError('Spend request not found after approval');
          setStatus('error');
          return;
        }

        if (approved && final.status === 'approved') {
          setResult(final);
          setStatus('success');
          setTimeout(() => onComplete(final), DISPLAY_DELAY_MS);
        } else {
          setError(
            `Spend request did not reach approved (status: ${final.status})`,
          );
          setStatus('error');
          setTimeout(() => onComplete(final), DISPLAY_DELAY_MS);
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
          setStatus('error');
        }
      } finally {
        close?.();
      }
    };

    run();
    return () => {
      cancelled = true;
      close?.();
    };
  }, [repository, id, onComplete]);

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

  return <ApprovalWaitingView approvalUrl={approvalUrl} />;
};
