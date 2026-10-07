import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { quoteForMessage } from '@/internal/bytes';

describe('failure messages', () => {
  it('quotes and truncates untrusted values', () => {
    assert.equal(quoteForMessage('plain'), '"plain"');
    assert.equal(quoteForMessage('a\nb'), '"a\\x0ab"');
    assert.equal(quoteForMessage('a"b'), '"a\\"b"');
    assert.match(quoteForMessage('x'.repeat(200)), /^"x{64}\.\.\."$/);
  });
});
