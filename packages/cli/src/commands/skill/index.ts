import type { Command } from 'commander';

declare const SKILL_CONTENT: string;
declare const __CLI_VERSION__: string;
declare const __BUILD_NUMBER__: string;

export function registerSkillCommand(program: Command): Command {
  return program
    .command('skill')
    .description('Output the Link CLI skill file')
    .action(() => {
      let content = SKILL_CONTENT;
      try {
        const version = `${__CLI_VERSION__}+${__BUILD_NUMBER__}`;
        content = SKILL_CONTENT.replace(
          '---\n',
          `---\ncli_version: "${version}"\n`,
        );
      } catch {
        process.stderr.write(
          'Warning: could not resolve cli_version — skill output without version\n',
        );
      }

     
    });
}
