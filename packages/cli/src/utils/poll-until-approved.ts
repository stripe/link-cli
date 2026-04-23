import type { ISpendRequestResource, SpendRequest } from '@stripe/link-sdk';

export interface PollOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
  onProgress?: (elapsedSeconds: number) => void;
}

export function pollUntilApproved(
  repository: ISpendRequestResource,
  id: string,
  options: PollOptions = {},
): Promise<SpendRequest> {
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 300_000;
  const startTime = Date.now();

  const poll = async (): Promise<SpendRequest> => {
    const elapsed = Date.now() - startTime;
    if (elapsed > timeoutMs) {
      throw new Error('Approval polling timed out');
    }

    const request = await repository.getSpendRequest(id);

    if (!request) {
      throw new Error(`Spend request ${id} not found`);
    }

    if (request.status !== 'created' && request.status !== 'pending_approval') {
      return request;
    }

    options.onProgress?.(Math.floor(elapsed / 1000));

    await new Promise<void>((r) => setTimeout(r, pollIntervalMs));
    return poll();
  };

  return poll();
}
