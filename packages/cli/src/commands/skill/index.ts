import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';

declare const SKILL_CONTENT: string;
declare const __CLI_VERSION__: string;
declare const __BUILD_NUMBER__: string;

export function registerSkillCommand(program: Command): Command {
  return program
    .command('skill')
    .description('Output the Link CLI skill file')
    .option('--install', 'Install the skill file into .claude or .agents')
    .action((options: { install?: boolean }) => {
      let content = SKILL_CONTENT;
      try {
        const version = `${__CLI_VERSION__}+${__BUILD_NUMBER__}`;
        content = SKILL_CONTENT.replace(
          '---\n',
          `---\ncli_version: "${version}"\n`,
        );
      } catch {
        process.stderr.write(
          'Warning: could not resolve cli_version — skill installed without version\n',
        );
      }

      if (options.install) {
        const baseDir = existsSync(join(process.cwd(), '.claude'))
          ? '.claude'
          : '.agents';
        const destDir = join(
          process.cwd(),
          baseDir,
          'skills',
          'create-payment-credential',
        );
        const destPath = join(destDir, 'SKILL.md');
        mkdirSync(destDir, { recursive: true });
        writeFileSync(destPath, content);
        process.stdout.write(`Skill installed to ${destPath}\n`);
      } else {
        process.stdout.write(content);
      }
    });
}
