import { describe, expect, it } from 'vitest';
import { formatRecurring } from '../format-recurring';

describe('formatRecurring', () => {
  it('omits a count of one and pluralizes larger counts', () => {
    expect(formatRecurring({ interval: 'month', interval_count: 1 })).toBe(
      'every month',
    );
    expect(formatRecurring({ interval: 'week', interval_count: 2 })).toBe(
      'every 2 weeks',
    );
  });
});
