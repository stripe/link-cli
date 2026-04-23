import type { ISpendRequestResource, SpendRequest } from '@stripe/link-sdk';
import { describe, expect, it, vi } from 'vitest';
import { pollUntilApproved } from '../poll-until-approved';

describe('pollUntilApproved', () => {
  it('resolves when status reaches approved', async () => {
    let calls = 0;
    const repo = {
      getSpendRequest: vi.fn(async () => {
        calls++;
        return {
          id: 'sr_1',
          status: calls < 2 ? 'pending_approval' : 'approved',
        } as SpendRequest;
      }),
    } as unknown as ISpendRequestResource;

    const result = await pollUntilApproved(repo, 'sr_1', {
      pollIntervalMs: 10,
      timeoutMs: 5000,
    });

    expect(result.status).toBe('approved');
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('keeps polling through created and pending_approval statuses', async () => {
    let calls = 0;
    const repo = {
      getSpendRequest: vi.fn(async () => {
        calls++;
        return {
          id: 'sr_1',
          status:
            calls < 2 ? 'created' : calls < 4 ? 'pending_approval' : 'approved',
        } as SpendRequest;
      }),
    } as unknown as ISpendRequestResource;

    const result = await pollUntilApproved(repo, 'sr_1', {
      pollIntervalMs: 10,
      timeoutMs: 5000,
    });

    expect(result.status).toBe('approved');
    expect(calls).toBeGreaterThanOrEqual(4);
  });

  it.each(['denied', 'expired', 'succeeded', 'failed'] as const)(
    'stops immediately on terminal status %s',
    async (terminalStatus) => {
      const repo = {
        getSpendRequest: vi.fn(async () => ({
          id: 'sr_1',
          status: terminalStatus,
        })) as unknown as ISpendRequestResource['getSpendRequest'],
      } as unknown as ISpendRequestResource;

      const result = await pollUntilApproved(repo, 'sr_1', {
        pollIntervalMs: 10,
        timeoutMs: 5000,
      });

      expect(result.status).toBe(terminalStatus);
    },
  );

  it('rejects on timeout', async () => {
    const repo = {
      getSpendRequest: vi.fn(
        async () =>
          ({
            id: 'sr_1',
            status: 'pending_approval',
          }) as SpendRequest,
      ),
    } as unknown as ISpendRequestResource;

    await expect(
      pollUntilApproved(repo, 'sr_1', { pollIntervalMs: 10, timeoutMs: 50 }),
    ).rejects.toThrow('timed out');
  });

  it('rejects if spend request is not found', async () => {
    const repo = {
      getSpendRequest: vi.fn(async () => null),
    } as unknown as ISpendRequestResource;

    await expect(
      pollUntilApproved(repo, 'sr_1', { pollIntervalMs: 10, timeoutMs: 500 }),
    ).rejects.toThrow('not found');
  });

  it('calls onProgress with elapsed seconds on each poll cycle', async () => {
    let calls = 0;
    const progressCalls: number[] = [];
    const repo = {
      getSpendRequest: vi.fn(async () => {
        calls++;
        return {
          id: 'sr_1',
          status: calls < 3 ? 'pending_approval' : 'approved',
        } as SpendRequest;
      }),
    } as unknown as ISpendRequestResource;

    await pollUntilApproved(repo, 'sr_1', {
      pollIntervalMs: 10,
      timeoutMs: 5000,
      onProgress: (elapsed) => progressCalls.push(elapsed),
    });

    // onProgress called at least once per pending poll cycle
    expect(progressCalls.length).toBeGreaterThanOrEqual(2);
    // elapsed is a non-negative integer
    expect(progressCalls.every((s) => s >= 0 && Number.isInteger(s))).toBe(
      true,
    );
  });
});
