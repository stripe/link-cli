import type { ISpendRequestResource, SpendRequest } from '@stripe/link-sdk';
import { useInput } from 'ink';
import { useEffect } from 'react';
import { DISPLAY_DELAY_MS } from '../../utils/constants';
import { openUrl } from '../../utils/open-url';
import { pollUntilApproved } from '../../utils/poll-until-approved';

export type ApprovalStatus =
  | 'waiting'
  | 'polling'
  | 'success'
  | 'error'
  | 'requires_action';

interface UseApprovalPollingOptions {
  status: string;
  setStatus: (s: 'polling' | 'success' | 'error' | 'requires_action') => void;
  approvalUrl: string;
  repository: ISpendRequestResource;
  requestId: string | null;
  onComplete: (result: SpendRequest) => void;
  onSuccess: (result: SpendRequest) => void;
  onError: (msg: string) => void;
  onRequiresAction: (result: SpendRequest) => void;
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
  onRequiresAction,
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
        if (cancelled) return;
        if (final.status === 'requires_action') {
          onRequiresAction(final);
          setStatus('requires_action');
          setTimeout(() => onComplete(final), DISPLAY_DELAY_MS);
          return;
        }
        if (final.status !== 'approved') {
          onError(
            `Spend request did not reach approved (status: ${final.status})`,
          );
          setStatus('error');
          setTimeout(() => onComplete(final), DISPLAY_DELAY_MS);
          return;
        }
        onSuccess(final);
        setStatus('success');
        setTimeout(() => onComplete(final), DISPLAY_DELAY_MS);
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
    onRequiresAction,
    setStatus,
  ]);
}
