import { describe, expect, it } from 'vitest';
import { renderQrMatrix } from '../render-qr-matrix';

const ALLOWED_CHARS = new Set(['█', '▀', '▄', ' ']);

describe('renderQrMatrix', () => {
  it('returns an array of strings for a valid URL', () => {
    const lines = renderQrMatrix('https://example.com');
    expect(lines.length).toBeGreaterThan(0);
  });

  it('all lines have equal length', () => {
    const lines = renderQrMatrix('https://example.com');
    const len = lines[0].length;
    for (const line of lines) {
      expect(line.length).toBe(len);
    }
  });

  it('only contains half-block and space characters', () => {
    const lines = renderQrMatrix('https://example.com');
    for (const line of lines) {
      for (const char of line) {
        expect(ALLOWED_CHARS.has(char)).toBe(true);
      }
    }
  });

  it('produces a square-ish output (width is roughly 2x height due to half-blocks)', () => {
    const lines = renderQrMatrix('https://example.com');
    // Each line covers 2 matrix rows; columns are 1:1
    // So width ≈ height * 2 (terminal chars are taller than wide)
    const width = lines[0].length;
    const height = lines.length;
    expect(width).toBeGreaterThanOrEqual(height);
  });
});
