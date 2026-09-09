import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installAuthoredSkills,
  isSkillsAddInvocation,
  removeLegacyIncurSkills,
} from '../skills-install';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

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
    const cleanup = vi.fn();

    expect(installAuthoredSkills([], run, cleanup)).toBe(0);
    expect(run).toHaveBeenCalledWith(
      'npx',
      ['--yes', 'skills', 'add', 'stripe/link-cli', '-g', '-y'],
      expect.objectContaining({ GH_HOST: 'github.com' }),
    );
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('preserves project-local installation', () => {
    const run = vi.fn(() => 0);
    const cleanup = vi.fn();

    expect(installAuthoredSkills(['--no-global'], run, cleanup)).toBe(0);
    expect(run).toHaveBeenCalledWith(
      'npx',
      ['--yes', 'skills', 'add', 'stripe/link-cli', '-y'],
      expect.objectContaining({ GH_HOST: 'github.com' }),
    );
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('does not clean up legacy skills when installation fails', () => {
    const cleanup = vi.fn();

    expect(installAuthoredSkills([], () => 1, cleanup)).toBe(1);
    expect(cleanup).not.toHaveBeenCalled();
  });

  it('removes only Incur-recorded generated skills and metadata', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'link-cli-skills-'));
    temporaryDirectories.push(root);
    const dataHome = path.join(root, 'data');
    const skillsDirectory = path.join(root, '.agents', 'skills');
    const generatedSkill = path.join(skillsDirectory, 'link-cli-auth');
    const authoredSkill = path.join(skillsDirectory, 'link-cli');
    const metadataPath = path.join(dataHome, 'incur', 'link-cli.json');
    fs.mkdirSync(generatedSkill, { recursive: true });
    fs.mkdirSync(authoredSkill, { recursive: true });
    fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
    fs.writeFileSync(
      metadataPath,
      JSON.stringify({
        hash: 'old-hash',
        skills: ['link-cli-auth', 'link-cli'],
        paths: [generatedSkill, authoredSkill],
      }),
    );

    removeLegacyIncurSkills({ dataHome, homeDir: root });

    expect(fs.existsSync(generatedSkill)).toBe(false);
    expect(fs.existsSync(authoredSkill)).toBe(true);
    expect(fs.existsSync(metadataPath)).toBe(false);
  });
});
