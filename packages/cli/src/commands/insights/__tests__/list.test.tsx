import type { IInsightsResource, InsightsPage } from '@stripe/link-sdk';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { InsightsList } from '../list';

function resource(page: InsightsPage): IInsightsResource {
  return {
    list: vi.fn(async () => page),
    listAvailableTypes: vi.fn(),
  };
}

describe('InsightsList', () => {
  it('renders known values, future values, and remediation without losing the page', async () => {
    const { lastFrame } = render(
      <InsightsList
        resource={resource({
          data: [
            {
              id: 'top_brand_by_transaction_count_per_category_t180d',
              description: 'Top brands',
              status: 'ready',
              as_of: 1790723779,
              data: [
                {
                  label: 'Clothing',
                  value: {
                    type: 'number_of_items',
                    number_of_items: { label: 'Marine Layer', count: 2 },
                  },
                },
                {
                  label: 'New metric',
                  value: { type: 'percentile', percentile: { value: 92 } },
                },
              ],
            },
            {
              id: 'another_insight',
              description: 'Other insight',
              status: 'no_data',
              error_code: 'missing_permissions',
              error_message: 'Additional authorization is required',
              authorization_remediation: {
                scope: ['userinfo:read'],
                authorization_details: [
                  { type: 'source', actions: ['read_link_transactions'] },
                ],
              },
            },
            {
              id: 'third_insight',
              description: 'Third insight',
              status: 'no_data',
              authorization_remediation: {
                scope: ['userinfo:read', 'payment_methods.agentic'],
                authorization_details: [
                  {
                    type: 'source',
                    actions: [
                      'read_link_transactions',
                      'read_external_transactions',
                    ],
                  },
                ],
              },
            },
          ],
          has_more: true,
        })}
        params={{}}
        onComplete={() => {}}
      />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Marine Layer (count: 2)');
      expect(frame).toContain('"type":"percentile"');
      expect(frame).toContain('Additional authorization is required');
      expect(frame).toContain('Upgrade access: link-cli auth upgrade');
      expect(frame).toContain('--source-actions read_link_transactions');
      expect(frame).toContain('--source-actions read_external_transactions');
      expect(frame).toContain('Next page: --starting-after third_insight');
    });
  });
});
