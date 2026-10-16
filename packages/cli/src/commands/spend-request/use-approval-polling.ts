import type { ISpendRequestResource, SpendRequest } from '@stripe/link-sdk';
import { useInput } from 'ink';
import { useEffect } from 'react';
import { DISPLAY_DELAY_MS } from '../../utils/constants';
import { openUrl } from '../../utils/open-url';
import { pollUntilApproved } from '../../utils/poll-until-approved';
import { pollUntilResumed } from '../../utils/poll-until-resumed';

export type ApprovalStatus =
  | 'waiting'
  | 'polling'
  | 'success'
  | 'error'
  | 'requires_action'
  | 'resuming'
  | 'resume_timeout';

interface UseApprovalPollingOptions {
  status: string;
  setStatus: (s: Exclude<ApprovalStatus, 'waiting'>) => void;
  approvalUrl: string;
  repository: ISpendRequestResource;
  requestId: string | null;
  onComplete: (result: SpendRequest | null) => void;
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
        if (
          final.status === 'requires_action' &&
          final.status_details?.requires_action?.next_action?.resolution ===
            'auto_resume'
        ) {
          onRequiresAction(final);
          setStatus('resuming');
          return;
        }
        if (final.status === 'requires_action') {
          onRequiresAction(final);
          setStatus('requires_action');
          setTimeout(() => onComplete(final), DISPLAY_DELAY_MS);
          return;
        }
        if (
          final.status !== 'approved' &&
          final.status !== 'submitted' &&
          final.status !== 'succeeded'
        ) {
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

  // Keep polling while the request waits on an auto_resume action (e.g. 3D
  // Secure or a partner auth challenge), whether it got there via approval
  // polling or directly from create.
  useEffect(() => {
    if (status !== 'resuming' || !requestId) return;

    let cancelled = false;

    const poll = async () => {
      const { request, timedOut } = await pollUntilResumed(
        repository,
        requestId,
        { isCancelled: () => cancelled },
      );
      if (cancelled) return;
      if (timedOut || !request) {
        setStatus('resume_timeout');
        setTimeout(() => onComplete(request), DISPLAY_DELAY_MS);
        return;
      }
      if (
        request.status === 'approved' ||
        request.status === 'submitted' ||
        request.status === 'succeeded'
      ) {
        onSuccess(request);
        setStatus('success');
      } else if (request.status === 'requires_action') {
        onRequiresAction(request);
        setStatus('requires_action');
      } else {
        onError(
          `Spend request did not resolve after verification (status: ${request.status})`,
        );
        setStatus('error');
      }
      setTimeout(() => onComplete(request), DISPLAY_DELAY_MS);
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
