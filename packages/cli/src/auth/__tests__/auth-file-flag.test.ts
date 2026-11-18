import { describe, expect, it } from 'vitest';
import { takeAuthFileFlag } from '../auth-file-flag';

describe('takeAuthFileFlag', () => {
  it('returns the flag value and strips the flag and value', () => {
    const argv = ['node', 'cli', 'auth', 'status', '--auth', 'work.json'];

    expect(takeAuthFileFlag(argv, 'env.json')).toEqual({ path: 'work.json' });
    expect(argv).toEqual(['node', 'cli', 'auth', 'status']);
  });

  it('falls back to LINK_AUTH_FILE when the flag is absent', () => {
    const argv = ['node', 'cli', 'auth', 'status'];

    expect(takeAuthFileFlag(argv, 'env.json')).toEqual({ path: 'env.json' });
    expect(argv).toEqual(['node', 'cli', 'auth', 'status']);
  });

  it.each([
    ['at the end of argv', ['node', 'cli', 'auth', 'logout', '--auth']],
    [
      'before another flag',
      ['node', 'cli', 'auth', 'logout', '--auth', '--format', 'json'],
    ],
    ['with an empty value', ['node', 'cli', 'auth', 'logout', '--auth', '']],
  ])('reports a missing value %s instead of falling back', (_, argv) => {
    const result = takeAuthFileFlag(argv, 'env.json');

    expect(result.path).toBeUndefined();
    expect(result.error).toContain('--auth');
    expect(argv).not.toContain('--auth');
    expect(argv).not.toContain('');
    expect(argv.slice(0, 4)).toEqual(['node', 'cli', 'auth', 'logout']);
  });

  it('leaves the following flag for incur to parse', () => {
    const argv = [
      'node',
      'cli',
      'auth',
      'status',
      '--auth',
      '--format',
      'json',
    ];

    takeAuthFileFlag(argv, undefined);

    expect(argv).toEqual(['node', 'cli', 'auth', 'status', '--format', 'json']);
  });
});
