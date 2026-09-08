import { describe, expect, it, vi } from 'vitest';
import {
  installAuthoredSkills,
  isSkillsAddInvocation,
} from '../skills-install';

describe('authored skill installation', () => {
  it('recognizes Incur skill-add invocations only', () => {
    expect(isSkillsAddInvocation(['skills', 'add'])).toBe(true);
    expect(isSkillsAddInvocation(['skill', 'add', '--no-global'])).toBe(true);
    expect(isSkillsAddInvocation(['skills', 'add', '--help'])).toBe(false);
    expect(isSkillsAddInvocation(['skill', 'add', '-h'])).toBe(false);
    expect(isSkillsAddInvocation(['skills', 'list'])).toBe(false);
    expect(isSkillsAddInvocation(['auth', 'login'])).toBe(false);
  });

  it('delegates global installation to the authored repository skills', () => {
    const run = vi.fn(() => 0);

    expect(installAuthoredSkills([], run)).toBe(0);
    expect(run).toHaveBeenCalledWith('npx', [
      '--yes',
      'skills',
      'add',
      'stripe/link-cli',
      '-g',
      '-y',
    ]);
  });

  it('preserves project-local installation', () => {
    const run = vi.fn(() => 0);

    expect(installAuthoredSkills(['--no-global'], run)).toBe(0);
    expect(run).toHaveBeenCalledWith('npx', [
      '--yes',
      'skills',
      'add',
      'stripe/link-cli',
      '-y',
    ]);
  });
});
