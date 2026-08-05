#!/usr/bin/env bun
/**
 * Build a single-file standalone link-cli binary for the requested target.
 *
 * Usage:
 *   bun run scripts/build-binary.ts <target>
 *
 * Targets: darwin-arm64 | darwin-x64 | linux-x64 | windows-x64
 *
 * Output is written to dist-bin/link-cli-<target>[.exe].
 *
 * The bundle entrypoint is the same packages/cli/dist/cli.js that tsup emits,
 * so this script must run AFTER `pnpm turbo run build`.
 *
 * Two of ink's transitive dependencies are stubbed at bundle time:
 * - react-devtools-core: only used when DEV=true; ink uses a dynamic import,
 *   but tsup bundles the static reference inside ink/build/devtools.js, which
 *   then breaks compile if the optional dep is not installed.
 * - update-notifier: marked external in tsup config; replaced with a noop
 *   so the standalone binary does not need the on-disk package present.
 */
import { mkdirSync } from 'node:fs';
import type { BunPlugin } from 'bun';

const TARGETS = {
  'darwin-arm64': 'bun-darwin-arm64',
  'darwin-x64': 'bun-darwin-x64',
  'linux-x64': 'bun-linux-x64',
  'windows-x64': 'bun-windows-x64',
} as const;

type Target = keyof typeof TARGETS;

const stubPlugin: BunPlugin = {
  name: 'stub-optional-deps',
  setup(build) {
    build.onResolve(
      { filter: /^(react-devtools-core|update-notifier)$/ },
      (args) => ({ path: args.path, namespace: 'stub' }),
    );
    build.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => {
      if (args.path === 'react-devtools-core') {
        return {
          contents: 'export default { connectToDevTools() {} };',
          loader: 'js',
        };
      }
      return {
        contents:
          'const noop = () => ({ notify: () => {} }); export default noop;',
        loader: 'js',
      };
    });
  },
};

const target = (process.argv[2] ?? 'darwin-arm64') as Target;
const flag = TARGETS[target];
if (!flag) {
  console.error(`Unknown target: ${target}`);
  console.error(`Valid targets: ${Object.keys(TARGETS).join(', ')}`);
  process.exit(1);
}

mkdirSync('dist-bin', { recursive: true });

const ext = target.startsWith('windows') ? '.exe' : '';
const outfile = `./dist-bin/link-cli-${target}${ext}`;

console.log(`Building ${flag} -> ${outfile}`);

await Bun.build({
  entrypoints: ['./packages/cli/dist/cli.js'],
  // @ts-expect-error compile is a Bun.build option but not in the public types yet
  compile: { target: flag, outfile },
  plugins: [stubPlugin],
  minify: true,
});
