import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { LinkTools } from '@stripe/link-integrations-mastra';
import type { LinkTools as SdkTools } from '@stripe/link-sdk/tools';
import { expect, expectTypeOf, it } from 'vitest';

it('imports built exports in Node without source files or credentials', async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { readdirSync } from 'node:fs';
    import { createLinkTools, linkSkillsPath } from '@stripe/link-integrations-mastra';
    const tools = createLinkTools({ getAccessToken() { throw new Error('Unexpected token lookup'); } });
    console.log(JSON.stringify({ names: Object.keys(tools), skills: readdirSync(linkSkillsPath).sort() }));
  `,
    ],
    { cwd: fileURLToPath(new URL('../', import.meta.url)) },
  );
  const result = JSON.parse(stdout);
  expect(result.names).toHaveLength(15);
  expect(result.names).toContain('create_spend_request');
  expect(result.skills).toEqual([
    'create-payment-credential',
    'financial-insights',
  ]);
});

it('publishes declarations preserving SDK inputs for each tool', () => {
  type Inputs<T extends LinkTools | SdkTools> = {
    [K in keyof T]: T[K] extends { execute?: infer Execute }
      ? Execute extends (...args: infer Args) => unknown
        ? Args[0]
        : never
      : never;
  };
  expectTypeOf<Inputs<LinkTools>>().toEqualTypeOf<Inputs<SdkTools>>();
});
