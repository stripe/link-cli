import type { ApprovalPolicy, IApprovalPolicyResource } from '@stripe/link-sdk';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalPolicyRetrieve } from './retrieve';

function makeResource(policy: ApprovalPolicy): IApprovalPolicyResource {
  return {
    retrieve: vi.fn(async () => policy),
  };
}

describe('approval-policy retrieve component', () => {
  it('renders all policy rule fields in order', async () => {
    const resource = makeResource({
      rules: [
        {
          action: 'spend_request_create',
          limits: {
            per_purchase: { amount: 5000, currency: 'usd' },
          },
          allowed_payment_methods: ['csmrpd_2', 'csmrpd_1'],
        },
      ],
    });

    const { lastFrame } = render(
      <ApprovalPolicyRetrieve resource={resource} onComplete={() => {}} />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('Approval Policy');
      expect(frame).toContain('Rule 1');
      expect(frame).toContain('Action: spend_request_create');
      expect(frame).toContain('Per-purchase limit: $50.00');
      expect(frame).toContain('Allowed payment methods: csmrpd_2, csmrpd_1');
    });
  });

  it('renders an explicitly empty payment method allowlist', async () => {
    const resource = makeResource({
      rules: [
        {
          action: 'spend_request_create',
          limits: {
            per_purchase: { amount: 5000, currency: 'usd' },
          },
          allowed_payment_methods: [],
        },
      ],
    });

    const { lastFrame } = render(
      <ApprovalPolicyRetrieve resource={resource} onComplete={() => {}} />,
    );

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Allowed payment methods: None');
    });
  });
});
