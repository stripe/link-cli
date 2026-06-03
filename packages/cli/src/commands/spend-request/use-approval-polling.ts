import type { ISpendRequestResource, SpendRequest } from '@stripe/link-sdk';
import { useInput } from 'ink';
import { useEffect } from 'react';
import { DISPLAY_DELAY_MS } from '../../utils/constants';
import { openUrl } from '../../utils/open-url';
import { pollUntilApproved } from '../../utils/poll-until-approved';

export type PollingTerminalStatus = 'approved' | 'denied' | 'expired' | 'error';

interface UseApprovalPollingOptions {
  // When false, only useInput is active — polling does not start. Use for the
  // callback-server path so the hook stays mounted without racing the server.
  enabled: boolean;
  status: string;
  setStatus: (s: 'polling') => void;
  approvalUrl: string;
  repository: ISpendRequestResource;
  requestId: string | null;
  onComplete: (result: SpendRequest) => void;
  onTerminal: (result: SpendRequest, status: PollingTerminalStatus) => void;
  onPollError: (msg: string) => void;
}

export function useApprovalPolling({
  enabled,
  status,
  setStatus,
  approvalUrl,
  repository,
  requestId,
  onComplete,
  onTerminal,
  onPollError,
}: UseApprovalPollingOptions): void {
  const isWaiting = status === 'waiting' || status === 'polling';

  useInput(
    (_input, key) => {
      if (key.return && approvalUrl) openUrl(approvalUrl);
    },
    { isActive: isWaiting },
  );

  useEffect(() => {
    if (!enabled || status !== 'waiting') return;
    const timeout = setTimeout(() => setStatus('polling'), 1000);
    return () => clearTimeout(timeout);
  }, [enabled, status, setStatus]);

  useEffect(() => {
    if (!enabled || status !== 'polling' || !requestId) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const final = await pollUntilApproved(repository, requestId);
        if (cancelled) return;

        const resolvedStatus: PollingTerminalStatus =
          final.status === 'approved'
            ? 'approved'
            : final.status === 'denied'
              ? 'denied'
              : final.status === 'expired'
                ? 'expired'
                : 'error';

        onTerminal(final, resolvedStatus);
        setTimeout(() => onComplete(final), DISPLAY_DELAY_MS);
      } catch (err) {
        if (!cancelled) {
          onPollError((err as Error).message);
        }
      }
    };

    poll();
    return () => {
      cancelled = true;
    };
  }, [enabled, status, requestId, repository, onComplete, onTerminal, onPollError]);
}
