import type { ISpendingPolicyResource, SpendingPolicy } from '@stripe/link-sdk';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { SpendingPolicyRetrieve } from './retrieve';

function makeResource(policy: SpendingPolicy): ISpendingPolicyResource {
  return {
    retrieve: vi.fn(async () => policy),
  };
}

describe('spending-policy retrieve component', () => {
  it('renders all policy rule fields in order', async () => {
    const resource = makeResource({
      rules: [
        {
          action: 'allow',
          approval_type: 'automatic',
          limits: {
            per_purchase: { amount: 5000, currency: 'usd' },
          },
          allowed_payment_methods: ['csmrpd_2', 'csmrpd_1'],
        },
        { action: 'allow' },
      ],
    });

    const { lastFrame } = render(
      <SpendingPolicyRetrieve resource={resource} onComplete={() => {}} />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('Spending Policy');
      expect(frame).toContain('Rule 1');
      expect(frame).toContain('Action: allow');
      expect(frame).toContain('Approval: automatic');
      expect(frame).toContain('Per-purchase limit: $50.00');
      expect(frame).toContain('Allowed payment methods: csmrpd_2, csmrpd_1');
      expect(frame).toContain('Rule 2');
    });
  });

  it('renders an explicitly empty payment method allowlist', async () => {
    const resource = makeResource({
      rules: [{ action: 'allow', allowed_payment_methods: [] }],
    });

    const { lastFrame } = render(
      <SpendingPolicyRetrieve resource={resource} onComplete={() => {}} />,
    );

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Allowed payment methods: None');
    });
  });
});
