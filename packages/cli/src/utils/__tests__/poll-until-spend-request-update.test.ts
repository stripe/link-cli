import type { ISpendRequestResource, SpendRequest } from '@stripe/link-sdk';
import { describe, expect, it, vi } from 'vitest';
import { pollUntilSpendRequestUpdate } from '../poll-until-spend-request-update';

function makeRequest(overrides: Partial<SpendRequest>): SpendRequest {
  return {
    id: 'sr_1',
    status: 'approved',
    amount: 1000,
    approval_url: 'https://app.link.com/approve/sr_1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('pollUntilSpendRequestUpdate', () => {
  it('keeps polling until the pending amount is applied', async () => {
    const retrieve = vi
      .fn()
      .mockResolvedValueOnce(makeRequest({ amount: 1000 }))
      .mockResolvedValueOnce(makeRequest({ amount: 2000 }));
    const repository = { retrieve } as unknown as ISpendRequestResource;

    const result = await pollUntilSpendRequestUpdate(repository, 'sr_1', 2000, {
      pollIntervalMs: 1,
    });

    expect(result.outcome).toBe('approved');
    expect(result.request.amount).toBe(2000);
    expect(retrieve).toHaveBeenCalledTimes(2);
  });

  it('stops as denied when the approval URL disappears', async () => {
    const request = makeRequest({ approval_url: undefined });
    const repository = {
      retrieve: vi.fn(async () => request),
    } as unknown as ISpendRequestResource;

    const result = await pollUntilSpendRequestUpdate(repository, 'sr_1', 2000);

    expect(result).toEqual({ request, outcome: 'denied' });
  });

  it('treats a matching amount as approved even if the URL also disappears', async () => {
    const request = makeRequest({ amount: 2000, approval_url: undefined });
    const repository = {
      retrieve: vi.fn(async () => request),
    } as unknown as ISpendRequestResource;

    const result = await pollUntilSpendRequestUpdate(repository, 'sr_1', 2000);

    expect(result.outcome).toBe('approved');
  });
});
