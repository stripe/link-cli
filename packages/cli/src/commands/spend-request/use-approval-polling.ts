import type { ISpendRequestResource, SpendRequest } from '@stripe/link-sdk';
import { useInput } from 'ink';
import { useEffect } from 'react';
import { openUrl } from '../../utils/open-url';
import { pollUntilApproved } from '../../utils/poll-until-approved';

export type ApprovalStatus = 'waiting' | 'polling' | 'success' | 'error';

interface UseApprovalPollingOptions {
  status: string;
  setStatus: (s: 'polling' | 'success' | 'error') => void;
  approvalUrl: string;
  repository: ISpendRequestResource;
  requestId: string | null;
  onComplete: () => void;
  onSuccess: (result: SpendRequest) => void;
  onError: (msg: string) => void;
}

export function useApprovalPolling({
  status,
  setStatus,
  approvalUrl,
  repository,
  requestId,
  onComplete,
  onSuccess,
  onError,
}: UseApprovalPollingOptions): void {
  const isWaiting = status === 'waiting' || status === 'polling';

  useInput(
    (_input, key) => {
      if (key.return && approvalUrl) openUrl(approvalUrl);
    },
    { isActive: isWaiting },
  );

  useEffect(() => {
    if (status !== 'waiting') return;
    const timeout = setTimeout(() => setStatus('polling'), 1000);
    return () => clearTimeout(timeout);
  }, [status, setStatus]);

  useEffect(() => {
    if (status !== 'polling' || !requestId) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const final = await pollUntilApproved(repository, requestId);
        if (!cancelled) {
          onSuccess(final);
          setStatus('success');
          setTimeout(onComplete, 1000);
        }
      } catch (err) {
        if (!cancelled) {
          onError((err as Error).message);
          setStatus('error');
        }
      }
    };

    poll();
    return () => {
      cancelled = true;
    };
  }, [
    status,
    requestId,
    repository,
    onComplete,
    onSuccess,
    onError,
    setStatus,
  ]);
}
