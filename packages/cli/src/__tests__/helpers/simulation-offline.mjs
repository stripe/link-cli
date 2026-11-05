// Test-only preload: fail and leave evidence even if an update checker catches errors.
import childProcess from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';

function forbidden() {
  process.stderr.write('SIMULATION_FORBIDDEN_SIDE_EFFECT\n');
  throw new Error('Simulation attempted networking or a subprocess');
}
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, ...args) => {
  // Yoga loads its bundled WASM through a data URL; this performs no egress.
  if (String(input).startsWith('data:application/octet-stream;base64,'))
    return originalFetch(input, ...args);
  return forbidden();
};
for (const module of [http, https]) {
  module.request = forbidden;
  module.get = forbidden;
}
net.connect = forbidden;
net.createConnection = forbidden;
net.Socket.prototype.connect = forbidden;
for (const method of [
  'spawn',
  'spawnSync',
  'exec',
  'execSync',
  'execFile',
  'execFileSync',
  'fork',
])
  childProcess[method] = forbidden;
const readFileSync = fs.readFileSync;
fs.readFileSync = function (file, ...args) {
  if (String(file) === process.env.LINK_AUTH_FILE) {
    process.stderr.write('SIMULATION_FORBIDDEN_AUTH_READ\n');
    throw new Error('Simulation read credentials');
  }
  return readFileSync.call(this, file, ...args);
};
if (process.env.LINK_SIMULATION_TEST_TTY === '1') {
  Object.defineProperty(process.stdout, 'isTTY', {
    value: true,
    configurable: true,
  });
  Object.defineProperty(process.stdin, 'isTTY', {
    value: true,
    configurable: true,
  });
}
syncBuiltinESMExports();
