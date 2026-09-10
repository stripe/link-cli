import type { ISpendRequestResource, SpendRequest } from '@stripe/link-sdk';

export interface SpendRequestUpdatePollOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface SpendRequestUpdatePollResult {
  request: SpendRequest;
  outcome: 'approved' | 'denied';
}

export async function pollUntilSpendRequestUpdate(
  repository: ISpendRequestResource,
  id: string,
  pendingAmount: number,
  options: SpendRequestUpdatePollOptions = {},
): Promise<SpendRequestUpdatePollResult> {
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 300_000;
  const startTime = Date.now();

  while (true) {
    if (Date.now() - startTime > timeoutMs) {
      throw new Error('Spend request update polling timed out');
    }

    const request = await repository.retrieve(id);
    if (!request) {
      throw new Error(`Spend request ${id} not found`);
    }

    if (request.amount === pendingAmount) {
      return { request, outcome: 'approved' };
    }

    if (!request.approval_url) {
      return { request, outcome: 'denied' };
    }

    await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}
