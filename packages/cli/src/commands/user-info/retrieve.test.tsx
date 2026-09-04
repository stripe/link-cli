import type { IUserInfoResource, UserInfo } from '@stripe/link-sdk';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { UserInfoRetrieve } from './retrieve';

function makeResource(userInfo: UserInfo): IUserInfoResource {
  return {
    retrieve: vi.fn(async () => userInfo),
  };
}

describe('user-info retrieve component', () => {
  it('renders finite Agent Wallet limits and step-up status', async () => {
    const resource = makeResource({
      email: 'jane@example.com',
      name: 'Jane Doe',
      phone: '+15555550123',
      agent_wallet_spend_limits: {
        per_transaction: { limit: 50000 },
        daily: { limit: 500000, used: 120000, remaining: 380000 },
        thirty_day: {
          limit: 2000000,
          used: 600000,
          remaining: 1400000,
        },
      },
      agent_wallet_step_up: { status: 'identity_verification' },
    });

    const { lastFrame } = render(
      <UserInfoRetrieve resource={resource} onComplete={() => {}} />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('Agent Wallet Spend Limits');
      expect(frame).toContain('Per-transaction: 50000 cents');
      expect(frame).toContain(
        'Daily: limit 500000 cents, used 120000 cents, remaining 380000 cents',
      );
      expect(frame).toContain(
        '30-day: limit 2000000 cents, used 600000 cents, remaining 1400000 cents',
      );
      expect(frame).toContain(
        'Agent Wallet step-up status: identity_verification',
      );
    });
  });

  it('renders unlimited limits while preserving numeric usage', async () => {
    const resource = makeResource({
      agent_wallet_spend_limits: {
        per_transaction: { limit: null },
        daily: { limit: null, used: 0, remaining: null },
        thirty_day: { limit: null, used: 12500, remaining: null },
      },
    });

    const { lastFrame } = render(
      <UserInfoRetrieve resource={resource} onComplete={() => {}} />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('Per-transaction: Unlimited');
      expect(frame).toContain('Daily: limit Unlimited, used 0 cents');
      expect(frame).toContain('remaining Unlimited');
      expect(frame).toContain('30-day: limit Unlimited, used 12500 cents');
    });
  });

  it('omits Agent Wallet output when enrichment is absent', async () => {
    const resource = makeResource({
      email: 'jane@example.com',
      name: 'Jane Doe',
      phone: '+15555550123',
    });

    const { lastFrame } = render(
      <UserInfoRetrieve resource={resource} onComplete={() => {}} />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('jane@example.com');
      expect(frame).not.toContain('Agent Wallet');
    });
  });

  it('renders independently available step-up enrichment', async () => {
    const resource = makeResource({
      agent_wallet_step_up: { status: 'not_required' },
    });

    const { lastFrame } = render(
      <UserInfoRetrieve resource={resource} onComplete={() => {}} />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('Agent Wallet step-up status: not_required');
      expect(frame).not.toContain('Agent Wallet Spend Limits');
    });
  });
});
