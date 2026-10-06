// Check README links and API references, including the executable README test.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const mods = {
  '@stripe/agent-identity': await import(
    new URL('dist/esm/index.js', root).href
  ),
  '@stripe/agent-identity/testing': await import(
    new URL('dist/esm/testing/index.js', root).href
  ),
};

function markdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = new URL(entry.name, dir);
    if (entry.isDirectory())
      return markdownFiles(new URL(`${entry.name}/`, dir));
    return entry.name.endsWith('.md') ? [path] : [];
  });
}
const docs = [
  new URL('README.md', root),
  new URL('AGENTS.md', root),
  ...markdownFiles(new URL('example/', root)),
  ...markdownFiles(new URL('test/', root)),
];
const readme = docs.map((path) => readFileSync(path, 'utf8')).join('\n');
const problems = [];
let checked = 0;

for (const match of readme.matchAll(
  /import\s*\{([^}]+)\}\s*\n?\s*from\s*'([^']+)'/g,
)) {
  const spec = match[2];
  const mod = mods[spec];
  if (mod === undefined) {
    // Node built-ins and third-party packages appear in the examples (node:test,
    // express). Only this package's own entry points are checked here.
    if (!spec.startsWith('@stripe/agent-identity')) continue;
    problems.push(`docs import from an unknown entry point: ${spec}`);
    continue;
  }
  for (const name of match[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    checked++;
    if (!(name in mod))
      problems.push(
        `docs import ${name} from ${spec}, which does not export it`,
      );
  }
}

// Methods the README calls on the facade.
const facade = mods['@stripe/agent-identity'].LinkVerifier;
for (const method of readme.matchAll(/verifier\.(\w+)\(/g)) {
  checked++;
  if (typeof facade.prototype[method[1]] !== 'function') {
    problems.push(
      `docs call verifier.${method[1]}(), which LinkVerifier does not have`,
    );
  }
}

// The Quickstart test example must be byte-identical to the test that actually runs,
// modulo import specifiers. Checking that an identifier exists is not enough: an example
// can reference only real names and still not work.
const readmeTest = [...readme.matchAll(/```ts\n([\s\S]*?)```/g)]
  .map((m) => m[1])
  .find((b) => b.includes('node:test'));
if (readmeTest === undefined) {
  problems.push('README.md no longer contains a runnable test example');
} else {
  const live = readFileSync(
    new URL('test/readme-example.test.ts', root),
    'utf8',
  );
  const normalize = (text) =>
    text
      .replace(/from '(\.\.\/src\/index\.js|@stripe\/agent-identity)'/g, 'PKG')
      .replace(
        /from '(\.\.\/src\/testing\/index\.js|@stripe\/agent-identity\/testing)'/g,
        'PKG_TESTING',
      )
      .replace(/\s+/g, ' ')
      .trim();
  if (!normalize(live).includes(normalize(readmeTest))) {
    problems.push(
      'the README.md test example no longer matches test/readme-example.test.ts, so it is ' +
        'not the code that actually runs',
    );
  }
  checked++;
}

// Validate relative Markdown links after removing fenced examples.
for (const doc of docs) {
  const body = readFileSync(doc, 'utf8').replace(/```[\s\S]*?```/g, '');
  for (const match of body.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (/^[a-z]+:/i.test(target)) continue;
    checked++;
    const [path] = target.split('#');
    const resolved = path
      ? resolve(dirname(fileURLToPath(doc)), path)
      : fileURLToPath(doc);
    if (!existsSync(resolved))
      problems.push(`${doc.pathname}: broken link ${target}`);
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(`  ${p}`);
  console.error(`${problems.length} documentation reference(s) do not resolve`);
  process.exit(1);
}
console.log(
  `all ${checked} references in ${docs.map((path) => path.pathname.split('/').slice(-2).join('/')).join(', ')} resolve`,
);
