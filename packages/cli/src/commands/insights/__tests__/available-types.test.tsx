import type {
  AvailableInsightTypesPage,
  IInsightsResource,
} from '@stripe/link-sdk';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { AvailableTypes } from '../available-types';

function resource(page: AvailableInsightTypesPage): IInsightsResource {
  return {
    list: vi.fn(),
    listAvailableTypes: vi.fn(async () => page),
  };
}

describe('AvailableTypes', () => {
  it('shows one upgrade command for the page', async () => {
    const { lastFrame } = render(
      <AvailableTypes
        resource={resource({
          data: [
            {
              id: 'first',
              description: 'First insight',
              authorization_remediation: {
                authorization_details: [
                  { type: 'source', actions: ['read_link_transactions'] },
                ],
              },
            },
            {
              id: 'second',
              description: 'Second insight',
              authorization_remediation: {
                authorization_details: [
                  { type: 'source', actions: ['read_external_transactions'] },
                ],
              },
            },
          ],
          has_more: false,
        })}
        params={{}}
        onComplete={() => {}}
      />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame() ?? '';
      const unwrappedFrame = frame.replace(/\n\s*/g, ' ');
      expect(frame).toContain('Additional authorization is required');
      expect(frame).toContain('Upgrade access: link-cli auth upgrade');
      expect(unwrappedFrame).toContain(
        '--source-actions read_link_transactions',
      );
      expect(unwrappedFrame).toContain(
        '--source-actions read_external_transactions',
      );
      expect(frame.match(/Upgrade access:/g)).toHaveLength(1);
    });
  });
});
