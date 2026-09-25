import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createLinkTools } from '@stripe/link-sdk/tools';
import { afterEach, expect, it } from 'vitest';

const exec = promisify(execFile);
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const eveRoot = fileURLToPath(new URL('../../', import.meta.resolve('eve')));
let appRoot: string | undefined;

afterEach(async () => {
  if (appRoot) await rm(appRoot, { recursive: true, force: true });
});

it('loads the built extension tools, instructions, and wallet skill', async () => {
  appRoot = await mkdtemp(join(tmpdir(), 'link-eve-test-'));
  await mkdir(join(appRoot, 'agent/extensions'), { recursive: true });
  await mkdir(join(appRoot, 'node_modules/@stripe'), { recursive: true });
  await symlink(eveRoot, join(appRoot, 'node_modules/eve'), 'junction');
  await symlink(
    packageRoot,
    join(appRoot, 'node_modules/@stripe/link-integrations-eve'),
    'junction',
  );
  await writeFile(
    join(appRoot, 'package.json'),
    JSON.stringify({
      name: 'link-extension-test',
      private: true,
      type: 'module',
      dependencies: { eve: '*', '@stripe/link-integrations-eve': '*' },
    }),
  );
  await writeFile(
    join(appRoot, 'agent/agent.ts'),
    "import { defineAgent } from 'eve';\nexport default defineAgent({ model: 'openai/gpt-4.1-mini' });\n",
  );
  await writeFile(
    join(appRoot, 'agent/instructions.md'),
    'Help the user with their wallet.\n',
  );
  await writeFile(
    join(appRoot, 'agent/extensions/link.ts'),
    "import link from '@stripe/link-integrations-eve';\nexport default link({ accessToken: 'test-token' });\n",
  );

  // Use Eve's real consumer discovery without invoking a model or Link's API.
  const { stdout } = await exec(
    process.execPath,
    [join(eveRoot, 'bin/eve.js'), 'info', '--json'],
    { cwd: appRoot, timeout: 25_000 },
  );
  const info = JSON.parse(stdout);
  const diagnostics = await readFile(info.artifacts.diagnostics, 'utf8');
  expect(info.status, diagnostics).toBe('ready');
  expect(info.diagnostics.errors).toBe(0);

  const tools = createLinkTools(() => {
    throw new Error('Discovery must not request a Link client');
  });
  expect(
    info.tools.filter((name: string) => name.startsWith('link__')),
  ).toEqual(
    Object.keys(tools)
      .map((name) => `link__${name}`)
      .sort(),
  );
  expect(info.skills).toEqual(['link__link-wallet']);

  const manifest = JSON.parse(
    await readFile(info.artifacts.compiledManifest, 'utf8'),
  );
  const instructions = await readFile(
    join(packageRoot, 'extension/instructions.md'),
    'utf8',
  );
  expect(manifest.instructions).toContainEqual(
    expect.objectContaining({
      logicalPath: 'instructions/link.md',
      content: instructions,
    }),
  );
  const skill = await readFile(
    join(packageRoot, 'extension/skills/link-wallet/SKILL.md'),
    'utf8',
  );
  expect(manifest.skills).toEqual([
    expect.objectContaining({
      name: 'link__link-wallet',
      markdown: skill.replace(/^---\n[\s\S]*?\n---\n\s*/, ''),
      sourceKind: 'skill-package',
    }),
  ]);
}, 30_000);
