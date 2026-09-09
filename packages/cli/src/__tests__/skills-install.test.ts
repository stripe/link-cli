import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installAuthoredSkills,
  installAuthoredSkillsNatively,
  isSkillsAddInvocation,
  removeLegacyIncurSkills,
} from '../skills-install';

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe('authored skill installation', () => {
  it('recognizes Incur skill-add invocations only', () => {
    expect(isSkillsAddInvocation(['skills', 'add'])).toBe(true);
    expect(isSkillsAddInvocation(['skill', 'add', '--no-global'])).toBe(true);
    expect(
      isSkillsAddInvocation([
        '--format',
        'json',
        'skills',
        'add',
        '--no-global',
      ]),
    ).toBe(true);
    expect(
      isSkillsAddInvocation(['skills', '--token-limit', '100', 'add']),
    ).toBe(true);
    expect(isSkillsAddInvocation(['skills', 'add', '--help'])).toBe(false);
    expect(isSkillsAddInvocation(['skill', 'add', '-h'])).toBe(false);
    expect(isSkillsAddInvocation(['skills', 'list'])).toBe(false);
    expect(isSkillsAddInvocation(['auth', 'login'])).toBe(false);
    expect(isSkillsAddInvocation(['--format', 'skills', 'add'])).toBe(false);
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
    const agentSkill = path.join(root, '.claude', 'skills', 'link-cli-auth');
    const authoredSkill = path.join(skillsDirectory, 'link-cli');
    const metadataPath = path.join(dataHome, 'incur', 'link-cli.json');
    fs.mkdirSync(generatedSkill, { recursive: true });
    fs.mkdirSync(agentSkill, { recursive: true });
    fs.mkdirSync(authoredSkill, { recursive: true });
    fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
    fs.writeFileSync(
      metadataPath,
      JSON.stringify({
        hash: 'old-hash',
        skills: ['link-cli-auth', 'link-cli'],
        paths: [generatedSkill, agentSkill, authoredSkill],
      }),
    );

    removeLegacyIncurSkills({ dataHome, homeDir: root });

    expect(fs.existsSync(generatedSkill)).toBe(false);
    expect(fs.existsSync(agentSkill)).toBe(false);
    expect(fs.existsSync(authoredSkill)).toBe(true);
    expect(fs.existsSync(metadataPath)).toBe(false);
  });

  it('installs embedded authored skills natively without generated skills', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'link-cli-native-'));
    temporaryDirectories.push(root);
    const syncSkills = vi.fn(async (name, commands, options) => {
      expect(name).toBe('link-cli-authored');
      expect(commands.size).toBe(0);
      expect(options.global).toBe(false);
      expect(options.cwd).toBe(root);
      const includeRoot = options.include?.[0]?.replace(/\/\*$/, '') ?? '';
      expect(
        fs.readFileSync(
          path.join(root, includeRoot, 'link-cli', 'SKILL.md'),
          'utf8',
        ),
      ).toBe('link skill');
      return { agents: [], paths: [], skills: [] };
    });
    const removeMetadata = vi.fn();

    await expect(
      installAuthoredSkillsNatively(['skills', 'add', '--no-global'], {
        authoredSkills: {
          'create-payment-credential/SKILL.md': 'payment skill',
          'financial-insights/SKILL.md': 'insights skill',
          'link-cli/SKILL.md': 'link skill',
        },
        cwd: root,
        removeMetadata,
        syncSkills,
      }),
    ).resolves.toBe(0);

    expect(syncSkills).toHaveBeenCalledOnce();
    expect(removeMetadata).toHaveBeenCalledOnce();
    expect(
      fs
        .readdirSync(root)
        .some((entry) => entry.startsWith('link-cli-skills-')),
    ).toBe(false);
  });

  it('installs only embedded skills through Incur native sync', async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'link-cli-native-sync-'),
    );
    temporaryDirectories.push(root);
    const dataHome = path.join(root, 'data');
    vi.stubEnv('XDG_DATA_HOME', dataHome);
    const skill = (name: string) =>
      `---\nname: ${name}\ndescription: Test skill.\n---\n`;

    await expect(
      installAuthoredSkillsNatively(['skills', 'add', '--no-global'], {
        authoredSkills: {
          'create-payment-credential/SKILL.md': skill(
            'create-payment-credential',
          ),
          'financial-insights/SKILL.md': skill('financial-insights'),
          'link-cli/SKILL.md': skill('link-cli'),
        },
        cwd: root,
      }),
    ).resolves.toBe(0);

    expect(fs.readdirSync(path.join(root, '.agents', 'skills')).sort()).toEqual(
      ['create-payment-credential', 'financial-insights', 'link-cli'],
    );
    expect(fs.existsSync(path.join(dataHome, 'incur', 'link-cli.json'))).toBe(
      false,
    );
  });
});
