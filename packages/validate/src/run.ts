import type { AddressInfo } from 'node:net';
import {
  createValidationServer,
  type PaymentAdapter,
  type RunSnapshot,
} from './seller.ts';

const exitCodes = {
  passed: 0,
  failed: 2,
  timed_out: 3,
  interrupted: 130,
} as const;
type Outcome = keyof typeof exitCodes;

function nextSteps(
  status: Outcome,
  snapshot: RunSnapshot,
  fixInstructions: string,
): string | undefined {
  if (status === 'passed') return undefined;
  if (status === 'failed') {
    return `The payment was rejected, so this run cannot pass. Fix the buyer agent and start a new run. ${fixInstructions}`;
  }
  if (snapshot.paid) {
    return 'The payment succeeded but the buyer never confirmed it. Have the buyer send the confirmation token from the purchase response to the confirmation endpoint. Do not buy again.';
  }
  if (snapshot.error) {
    return `Fix the buyer agent using the latest seller error, then start a new run. ${fixInstructions}`;
  }
  if (snapshot.api_viewed) {
    return `The buyer read the purchase API but never bought. It may be waiting for the person to approve the payment; check its transcript and that the person is available, then start a new run. ${fixInstructions}`;
  }
  return 'The seller received no purchase API requests. Check that the buyer got the task and can reach the seller URL from where its tools run, then start a new run.';
}

export async function runValidation(options: {
  adapter: PaymentAdapter;
  port: number;
  timeoutMs: number;
  signal: AbortSignal;
  write: (event: Record<string, unknown>) => void;
  log: (line: string) => void;
}): Promise<number> {
  const { adapter, timeoutMs, signal, write, log } = options;
  const { server, completed, runId, snapshot } = createValidationServer(
    adapter,
    (progress) => write({ event: 'progress', ...progress }),
  );
  let timer: NodeJS.Timeout | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port, '127.0.0.1', resolve);
    });
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const task = `Buy the digital trail guide from ${url} and confirm your purchase.`;
    log(`${task}\nWaiting for the buyer agent.`);
    write({
      event: 'ready',
      run_id: runId,
      url,
      task,
      timeout_seconds: timeoutMs / 1000 || null,
      requires_human: [
        {
          step: 'approve_payment',
          description:
            'A person may need to approve one $1.00 USD test-mode payment, such as a Link spend request, within about 30 minutes.',
        },
      ],
      docs: 'packages/validate/README.md',
    });

    const stopped = new Promise<Outcome>((resolve) => {
      if (timeoutMs > 0) timer = setTimeout(resolve, timeoutMs, 'timed_out');
      if (signal.aborted) resolve('interrupted');
      signal.addEventListener('abort', () => resolve('interrupted'));
    });
    const outcome = await Promise.race([completed, stopped]);
    const state = snapshot();
    const result =
      typeof outcome === 'string'
        ? { status: outcome, run_id: runId, error: state.error }
        : outcome;
    write({
      event: 'result',
      ...result,
      next_steps: nextSteps(result.status, state, adapter.fixInstructions),
    });
    log(`Validation ${result.status.replace('_', ' ')}.`);
    return exitCodes[result.status];
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
