// Marks dist/cjs as CommonJS.
//
// The package root declares "type": "module", which would otherwise make Node
// parse the CJS build's .js files as ESM. A nested package.json scoped to the
// directory is the supported way to say "everything under here is CommonJS".
import { writeFile } from 'node:fs/promises';

await writeFile(
  new URL('../dist/cjs/package.json', import.meta.url),
  `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`,
);
