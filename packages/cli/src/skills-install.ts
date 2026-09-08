import { spawnSync } from 'node:child_process';

const SKILLS_REPOSITORY = 'stripe/link-cli';

// Prior art: Shopify's ucp-cli uses the same pre-dispatch interception point to
// replace Incur's generated skill sync with curated behavior:
// https://github.com/Shopify/ucp-cli/blob/main/src/cli/skills-sync.ts
export function isSkillsAddInvocation(argv: readonly string[]): boolean {
  return (
    (argv[0] === 'skills' || argv[0] === 'skill') &&
    argv[1] === 'add' &&
    !argv.includes('--help') &&
    !argv.includes('-h')
  );
}

type InstallerRunner = (command: string, args: readonly string[]) => number;

export function installAuthoredSkills(
  argv: readonly string[],
  run: InstallerRunner = runInstaller,
): number {
  const args = ['--yes', 'skills', 'add', SKILLS_REPOSITORY];
  if (!argv.includes('--no-global')) args.push('-g');
  args.push('-y');
  return run('npx', args);
}

function runInstaller(command: string, args: readonly string[]): number {
  const result = spawnSync(command, [...args], { stdio: 'inherit' });
  if (result.error) {
    process.stderr.write(
      `Failed to install Link CLI skills: ${result.error.message}\n`,
    );
    return 1;
  }
  return result.status ?? 1;
}
