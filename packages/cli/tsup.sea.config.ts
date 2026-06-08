import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));

const stubPackages = {
  name: 'stub-optional-packages',
  setup(build) {
    const filter = /^(react-devtools-core|update-notifier)$/;
    build.onResolve({ filter }, (args) => ({
      path: args.path,
      namespace: 'stub',
    }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'export default undefined;',
      loader: 'js',
    }));
  },
};

export default defineConfig({
  entry: ['src/cli.tsx'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist/sea',
  clean: true,
  splitting: false,
  sourcemap: false,
  noExternal: [/.*/],
  banner: {
    js: [
      '#!/usr/bin/env node',
      'import { createRequire as __sea_createRequire } from "node:module";',
      'var require = __sea_createRequire(import.meta.url);',
    ].join('\n'),
  },
  define: {
    __CLI_VERSION__: JSON.stringify(pkg.version),
    __CLI_NAME__: JSON.stringify(pkg.name),
  },
  esbuildPlugins: [stubPackages],
});
