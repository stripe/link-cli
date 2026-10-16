import type { ISpendRequestResource, SpendRequest } from '@stripe/link-sdk';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { RequestApproval } from '../request-approval';

vi.mock('../../../utils/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/constants')>()),
  RESUME_POLL_INTERVAL_MS: 10,
  RESUME_TIMEOUT_MS: 100,
}));

describe('resume timeout', () => {
  it('completes with the last known request when every resume poll fails', async () => {
    const challenge = {
      id: 'sr_test',
      status: 'requires_action',
      status_details: {
        requires_action: {
          next_action: {
            type: 'partner_auth_challenge',
            resolution: 'auto_resume',
            display_message: 'Complete verification in the Link app.',
            action_url: null,
          },
        },
      },
    } as SpendRequest;
    let calls = 0;
    const repo = {
      requestApproval: vi.fn(async () => ({
        id: 'sr_test',
        approval_url: 'https://app.link.com/approve/sr_test',
      })),
      retrieve: vi.fn(async () => {
        calls++;
        if (calls === 1) return challenge;
        throw new Error('network');
      }),
    } as unknown as ISpendRequestResource;
    const onComplete = vi.fn();

    const { lastFrame, unmount } = render(
      <RequestApproval
        repository={repo}
        id="sr_test"
        onComplete={onComplete}
      />,
    );
    try {
      await vi.waitFor(
        () =>
          expect(lastFrame()).toContain(
            'Timed out waiting for verification to resolve',
          ),
        { timeout: 3000 },
      );
      await vi.waitFor(
        () =>
          expect(onComplete).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'sr_test' }),
          ),
        { timeout: 3000 },
      );
      expect(onComplete).not.toHaveBeenCalledWith(null);
    } finally {
      unmount();
    }
  });
});
