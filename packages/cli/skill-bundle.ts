import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const authoredSkillFiles = [
  'create-payment-credential/SKILL.md',
  'financial-insights/SKILL.md',
  'link-cli/SKILL.md',
];

export function authoredSkillsDefine(packageDirectory: string): string {
  const skillsDirectory = join(packageDirectory, '..', '..', 'skills');
  return JSON.stringify(
    Object.fromEntries(
      authoredSkillFiles.map((relativePath) => [
        relativePath,
        readFileSync(join(skillsDirectory, relativePath), 'utf8'),
      ]),
    ),
  );
}
