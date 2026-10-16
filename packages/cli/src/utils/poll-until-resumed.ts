import type { ISpendRequestResource, SpendRequest } from '@stripe/link-sdk';
import { RESUME_POLL_INTERVAL_MS, RESUME_TIMEOUT_MS } from './constants';

export interface PollUntilResumedOptions {
  intervalMs?: number;
  timeoutMs?: number;
  isCancelled?: () => boolean;
}

export interface PollUntilResumedResult {
  /** The most recently retrieved request, or null if none was retrieved. */
  request: SpendRequest | null;
  timedOut: boolean;
}

function isAutoResume(request: SpendRequest): boolean {
  return (
    request.status === 'requires_action' &&
    request.status_details?.requires_action?.next_action?.resolution ===
      'auto_resume'
  );
}

/**
 * Polls a spend request while it is `requires_action` with an `auto_resume`
 * resolution (e.g. 3D Secure, partner auth challenge). Resolves with the first
 * request that leaves that state, or with `timedOut` once the deadline passes.
 * Transient retrieve errors are ignored.
 */
export async function pollUntilResumed(
  repository: ISpendRequestResource,
  id: string,
  options: PollUntilResumedOptions = {},
): Promise<PollUntilResumedResult> {
  const intervalMs = options.intervalMs ?? RESUME_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? RESUME_TIMEOUT_MS;
  const isCancelled = options.isCancelled ?? (() => false);
  const deadline = Date.now() + timeoutMs;
  let latest: SpendRequest | null = null;

  while (!isCancelled()) {
    if (Date.now() > deadline) {
      return { request: latest, timedOut: true };
    }

    await new Promise((r) => setTimeout(r, intervalMs));
    if (isCancelled()) break;

    let retrieved: SpendRequest | null;
    try {
      retrieved = await repository.retrieve(id);
    } catch {
      continue;
    }
    if (!retrieved) continue;

    latest = retrieved;
    if (!isAutoResume(retrieved)) {
      return { request: retrieved, timedOut: false };
    }
  }

  return { request: latest, timedOut: false };
}
