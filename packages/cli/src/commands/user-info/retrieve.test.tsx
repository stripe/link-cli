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
  it('renders finite Agent Wallet limits and verification requirement', async () => {
    const resource = makeResource({
      email: 'jane@example.com',
      name: 'Jane Doe',
      phone: '+15555550123',
      address: {
        line1: '510 Townsend St',
        line2: null,
        city: 'San Francisco',
        state: 'CA',
        postal_code: '94103',
        country: 'US',
      },
      eligible_for_balance: false,
      agent_wallet_spend_limits: {
        per_transaction: { limit: 50000 },
        daily: { limit: 500000, used: 120000, remaining: 380000 },
        thirty_day: {
          limit: 2000000,
          used: 600000,
          remaining: 1400000,
        },
      },
      agent_wallet_verification_requirement: {
        status: 'identity_verification',
        action_url:
          'https://app.link.com/finish_setup?verify=identity_verification&intended_email=jane%40example.com&fromEmail=jane%40example.com',
      },
    });

    const { lastFrame } = render(
      <UserInfoRetrieve resource={resource} onComplete={() => {}} />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('Agent Wallet Spend Limits');
      expect(frame).toContain('Address');
      expect(frame).toContain('Line 1: 510 Townsend St');
      expect(frame).toContain('Line 2: Not set');
      expect(frame).toContain('City: San Francisco');
      expect(frame).toContain('State: CA');
      expect(frame).toContain('Postal code: 94103');
      expect(frame).toContain('Country: US');
      expect(frame).toContain('Eligible for balance: No');
      expect(frame).toContain('Per-transaction: 50000 cents');
      expect(frame).toContain(
        'Daily: limit 500000 cents, used 120000 cents, remaining 380000 cents',
      );
      expect(frame).toContain(
        '30-day: limit 2000000 cents, used 600000 cents, remaining 1400000 cents',
      );
      expect(frame).toContain(
        'Agent Wallet verification requirement: identity_verification',
      );
      expect(frame).toContain(
        'Action URL: https://app.link.com/finish_setup?verify=identity_verification',
      );
      expect(frame).toContain('fromEmail=jane%40example.com');
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
      expect(frame).not.toContain('Address');
      expect(frame).not.toContain('Eligible for balance');
    });
  });

  it('renders an independently available verification requirement', async () => {
    const resource = makeResource({
      agent_wallet_verification_requirement: {
        status: 'not_required',
        action_url: null,
      },
    });

    const { lastFrame } = render(
      <UserInfoRetrieve resource={resource} onComplete={() => {}} />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain(
        'Agent Wallet verification requirement: not_required',
      );
      expect(frame).not.toContain('Action URL:');
      expect(frame).not.toContain('Agent Wallet Spend Limits');
    });
  });
});
