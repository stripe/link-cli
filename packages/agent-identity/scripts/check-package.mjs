// Run after building the package. Installs the packed tarball into a throwaway project and imports it, once as
// ESM and once as CommonJS.
//
// This exists because every other check in this repo runs against the source
// tree, where module resolution behaves differently than it does inside
// node_modules. A package can pass typecheck, build, and the full test suite and
// still be impossible for a consumer to import. That happened, so it is checked.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

const dir = mkdtempSync(join(tmpdir(), 'agent-identity-consumer-'));
try {
  const packed = run(
    'npm',
    ['pack', '--ignore-scripts', '--json', '--pack-destination', dir],
    root,
  );
  const archive = JSON.parse(packed)[0];
  if (archive.files.some(({ path }) => path.includes('/__tests__/'))) {
    throw new Error(
      'the published package must not include tests or test helpers',
    );
  }
  const tarball = join(dir, archive.filename);
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'c', private: true }),
  );
  run(
    'npm',
    [
      'install',
      '--prefer-offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      tarball,
    ],
    dir,
  );
  const instructions = readFileSync(
    join(dir, 'node_modules/@stripe/agent-identity/AGENTS.md'),
    'utf8',
  );
  if (!instructions.includes('LinkVerifier'))
    throw new Error('packaged agent instructions are missing');
  readFileSync(
    join(dir, 'node_modules/@stripe/agent-identity/src/index.ts'),
    'utf8',
  );

  writeFileSync(
    join(dir, 'esm.mjs'),
    `import * as verifierPackage from '@stripe/agent-identity';
     import { LinkVerifier, verifyAttestation, verifyAttestationOrThrow, FAILURE_CODES, isRejection } from '@stripe/agent-identity';
     import { LinkFixture, CredentialFixture } from '@stripe/agent-identity/testing';
     for (const [name, v] of Object.entries({ LinkVerifier, verifyAttestation, verifyAttestationOrThrow, isRejection, LinkFixture, CredentialFixture })) {
       if (typeof v !== 'function') throw new Error(name + ' is missing from the published package');
     }
     if (!Array.isArray(FAILURE_CODES)) throw new Error('FAILURE_CODES is missing');
     for (const removed of ['MemoryStore', 'rememberNonce']) {
       if (removed in verifierPackage) throw new Error(removed + ' must not be exported');
     }
     if (FAILURE_CODES.includes('store_unavailable')) throw new Error('store_unavailable must not be exported');
     console.log('esm ok');\n`,
  );
  writeFileSync(
    join(dir, 'cjs.cjs'),
    `const verifierPackage = require('@stripe/agent-identity');
     const { LinkVerifier, FAILURE_CODES } = verifierPackage;
     const { LinkFixture, CredentialFixture, combineFetch } = require('@stripe/agent-identity/testing');
     if (typeof LinkFixture !== 'function' || typeof CredentialFixture !== 'function') throw new Error('CommonJS testing exports missing');
     if (typeof LinkVerifier !== 'function') throw new Error('LinkVerifier missing');
     if (!Array.isArray(FAILURE_CODES)) throw new Error('FAILURE_CODES missing');
     for (const removed of ['MemoryStore', 'rememberNonce']) {
       if (removed in verifierPackage) throw new Error(removed + ' must not be exported');
     }
     if (FAILURE_CODES.includes('store_unavailable')) throw new Error('store_unavailable must not be exported');
     // Exercise async jose imports as well as require(), including on Node 22.0.
     (async () => {
       const assert = require('node:assert/strict');
       const link = await LinkFixture.create();
       const credential = await CredentialFixture.create({ issuerUrl: link.issuer, claims: { email: 'guest@example.com' } });
       const verifier = new LinkVerifier({ origin: 'https://events.example', fetchImpl: combineFetch(link.fetchImpl(), credential.fetchImpl()) });
       assert.equal((await verifier.verifyAttestation((await link.mint()).authorization)).valid, true);
       assert.equal((await verifier.verifyAttestation((await link.mint({ corruptAuthenticator: true })).authorization)).valid, false);
       const challenge = await verifier.claimsChallenge({ claims: ['email'] });
       const presentation = await credential.present({ aud: challenge.body.aud, nonce: challenge.nonce, disclose: ['email'] });
       const result = await verifier.verifyClaims(presentation, { nonce: challenge.nonce, requiredClaims: ['email'] });
       assert.equal(result.valid, true);
       assert.equal(result.claims.email, 'guest@example.com');
       assert.equal((await verifier.verifyClaims(presentation, { nonce: 'wrong', requiredClaims: ['email'] })).valid, false);
       console.log('cjs verification ok');
     })().catch(error => { console.error(error); process.exitCode = 1; });\n`,
  );

  process.stdout.write(run('node', ['esm.mjs'], dir));
  process.stdout.write(run('node', ['cjs.cjs'], dir));
  for (const example of ['verify.mjs', 'step-up/demo.mjs']) {
    process.stdout.write(
      run(
        'node',
        [join('node_modules/@stripe/agent-identity/example', example)],
        dir,
      ),
    );
  }
  const testingGuide = readFileSync(
    join(dir, 'node_modules/@stripe/agent-identity/test/README.md'),
    'utf8',
  );
  if (!testingGuide.includes('CredentialFixture'))
    throw new Error('packaged testing guide is missing');
  console.log(
    'package and examples work from an isolated installation in both module systems',
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
