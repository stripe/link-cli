import { execFile } from 'node:child_process';
import {
  copyFile,
  cp,
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
import extension from '../extension/extension';

const exec = promisify(execFile);
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const eveRoot = fileURLToPath(
  new URL('./', import.meta.resolve('eve/package.json')),
);
let appRoot: string | undefined;

afterEach(async () => {
  if (appRoot) await rm(appRoot, { recursive: true, force: true });
});

it('accepts exactly one of a static token and an Eve provider', () => {
  const auth = { getToken: async () => ({ token: 'test-token' }) };
  expect(extension.schema.safeParse({ accessToken: 'static' }).success).toBe(
    true,
  );
  expect(extension.schema.safeParse({ auth }).success).toBe(true);
  for (const value of [
    {},
    { auth: {} },
    { accessToken: ' ' },
    { accessToken: 'static', auth },
  ]) {
    expect(extension.schema.safeParse(value).success).toBe(false);
  }
});

it.each(['accessToken', 'auth'])(
  'loads the built distribution with %s authentication and no extension source',
  async (authentication) => {
    appRoot = await mkdtemp(join(tmpdir(), 'link-eve-test-'));
    await mkdir(join(appRoot, 'agent/extensions'), { recursive: true });
    await mkdir(join(appRoot, 'node_modules/@stripe'), { recursive: true });
    await symlink(eveRoot, join(appRoot, 'node_modules/eve'), 'junction');
    const installedRoot = join(
      appRoot,
      'node_modules/@stripe/link-integrations-eve',
    );
    await mkdir(installedRoot);
    await copyFile(
      join(packageRoot, 'package.json'),
      join(installedRoot, 'package.json'),
    );
    await cp(join(packageRoot, 'dist'), join(installedRoot, 'dist'), {
      recursive: true,
    });
    await symlink(
      join(packageRoot, 'node_modules'),
      join(installedRoot, 'node_modules'),
      'junction',
    );

    const compatibility = JSON.parse(
      await readFile(
        join(installedRoot, 'dist/extension/_manifest.json'),
        'utf8',
      ),
    );
    const evePackage = JSON.parse(
      await readFile(join(eveRoot, 'package.json'), 'utf8'),
    );
    expect(compatibility).toEqual({
      kind: 'eve-extension',
      formatVersion: 3,
      builtWithEve: evePackage.version,
      contractMajor: expect.any(Number),
    });
    await writeFile(
      join(appRoot, 'package.json'),
      JSON.stringify({
        name: 'link-extension-test',
        private: true,
        type: 'module',
        dependencies: { eve: '*', '@stripe/link-integrations-eve': '*' },
      }),
    );
    // An explicit context window keeps discovery independent of model metadata APIs.
    await writeFile(
      join(appRoot, 'agent/agent.ts'),
      "import { defineAgent } from 'eve';\nexport default defineAgent({ model: 'openai/gpt-4.1-mini', modelContextWindowTokens: 1_000_000 });\n",
    );
    await writeFile(
      join(appRoot, 'agent/instructions.md'),
      'Help the user with their wallet.\n',
    );
    if (authentication === 'auth') {
      await writeFile(
        join(appRoot, 'agent/extensions/link.ts'),
        `import link from '@stripe/link-integrations-eve';
import { defineInteractiveAuthorization } from 'eve/connections';
const unexpected = async () => { throw new Error('Discovery must not invoke authorization'); };
export default link({ auth: defineInteractiveAuthorization({
  getToken: unexpected,
  startAuthorization: unexpected,
  completeAuthorization: unexpected,
}) });\n`,
      );
    } else {
      await writeFile(
        join(appRoot, 'agent/extensions/link.ts'),
        "import link from '@stripe/link-integrations-eve';\nexport default link({ accessToken: 'test-token' });\n",
      );
    }

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
    const skillNames = ['create-payment-credential', 'financial-insights'];
    expect(info.skills).toEqual(skillNames.map((name) => `link__${name}`));

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
    expect(manifest.skills).toHaveLength(skillNames.length);
    for (const name of skillNames) {
      const skill = await readFile(
        join(packageRoot, 'extension/skills', name, 'SKILL.md'),
        'utf8',
      );
      expect(manifest.skills).toContainEqual(
        expect.objectContaining({
          name: `link__${name}`,
          content: skill.replace(/^---\n[\s\S]*?\n---\n\s*/, ''),
          sourceKind: 'skill-package',
        }),
      );
    }
  },
  30_000,
);
