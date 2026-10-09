import { parseArgs } from 'node:util';
import { runValidation } from './run.ts';
import { createSptAdapter } from './spt.ts';
import { readStripeTestKey } from './stripe-config.ts';

const help = `Usage: pnpm validate [--timeout <seconds>] [--port <port>]

Starts a local test seller. Give the printed task to a buyer agent. The run
passes when the agent pays $1.00 with a test-mode SPT and confirms the purchase.
See packages/validate/README.md.

--timeout defaults to 1800 seconds; 0 waits indefinitely.
Exit codes: 0 passed, 1 setup error, 2 failed, 3 timed out, 130 interrupted.`;

async function main() {
  const { values } = parseArgs({
    options: {
      port: { type: 'string', default: '0' },
      timeout: { type: 'string', default: '1800' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) return console.log(help);
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('--port must be an integer from 0 to 65535.');
  }
  const timeout = Number(values.timeout);
  if (!Number.isInteger(timeout) || timeout < 0) {
    throw new Error('--timeout must be a whole number of seconds.');
  }

  const adapter = createSptAdapter(readStripeTestKey());
  const interrupt = new AbortController();
  process.once('SIGINT', () => interrupt.abort());
  process.once('SIGTERM', () => interrupt.abort());
  process.exitCode = await runValidation({
    adapter,
    port,
    timeoutMs: timeout * 1000,
    signal: interrupt.signal,
    write: (event) => console.log(JSON.stringify(event)),
    log: (line) => console.error(line),
  });
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
