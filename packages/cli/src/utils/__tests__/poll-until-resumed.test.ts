import type { ISpendRequestResource, SpendRequest } from '@stripe/link-sdk';
import { describe, expect, it, vi } from 'vitest';
import { pollUntilResumed } from '../poll-until-resumed';

const challenge = {
  id: 'sr_1',
  status: 'requires_action',
  status_details: {
    requires_action: {
      next_action: {
        type: 'partner_auth_challenge',
        resolution: 'auto_resume',
        display_message: 'Verify in Link.',
        action_url: 'https://app.link.com/verify',
      },
    },
  },
} as SpendRequest;

const retry = {
  id: 'sr_1',
  status: 'requires_action',
  status_details: {
    requires_action: {
      next_action: {
        type: 'partner_auth_challenge_retry',
        resolution: 'create_new_spend_request',
        display_message: 'Verification failed.',
        action_url: null,
      },
    },
  },
} as SpendRequest;

function makeRepo(
  results: Array<SpendRequest | Error>,
): ISpendRequestResource & { retrieve: ReturnType<typeof vi.fn> } {
  let call = 0;
  return {
    retrieve: vi.fn(async () => {
      const result = results[Math.min(call, results.length - 1)];
      call++;
      if (result instanceof Error) throw result;
      return result;
    }),
  } as unknown as ISpendRequestResource & {
    retrieve: ReturnType<typeof vi.fn>;
  };
}

describe('pollUntilResumed', () => {
  it('keeps polling through auto_resume and transient errors until the status changes', async () => {
    const approved = { id: 'sr_1', status: 'approved' } as SpendRequest;
    const repo = makeRepo([challenge, new Error('network'), approved]);

    const result = await pollUntilResumed(repo, 'sr_1', { intervalMs: 10 });

    expect(result).toEqual({ request: approved, timedOut: false });
    expect(repo.retrieve).toHaveBeenCalledTimes(3);
  });

  it('stops on requires_action without auto_resume', async () => {
    const repo = makeRepo([challenge, retry]);

    const result = await pollUntilResumed(repo, 'sr_1', { intervalMs: 10 });

    expect(result).toEqual({ request: retry, timedOut: false });
  });

  it('times out with the last retrieved request', async () => {
    const repo = makeRepo([challenge]);

    const result = await pollUntilResumed(repo, 'sr_1', {
      intervalMs: 10,
      timeoutMs: 50,
    });

    expect(result).toEqual({ request: challenge, timedOut: true });
  });
});
