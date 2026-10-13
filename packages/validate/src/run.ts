import type { AddressInfo } from 'node:net';
import { type LinkCli, linkCli } from './link.ts';
import { createValidationServer, type PaymentAdapter } from './seller.ts';
import {
  validations as defaultValidations,
  type Validation,
  type Verdict,
} from './validations/index.ts';

const exitCodes = {
  passed: 0,
  failed: 2,
  timed_out: 3,
  interrupted: 130,
} as const;
type Outcome = keyof typeof exitCodes;

export async function runValidation(options: {
  adapter: PaymentAdapter;
  port: number;
  timeoutMs: number;
  signal: AbortSignal;
  write: (event: Record<string, unknown>) => void;
  log: (line: string) => void;
  validations?: Validation[];
  link?: LinkCli;
  pollMs?: number;
  // Tasks run in order. A validation still pending this long after the
  // previous one finished is evaluated as final.
  graceMs?: number;
}): Promise<number> {
  const { adapter, timeoutMs, signal, write, log } = options;
  const validations = options.validations ?? defaultValidations;
  const link = options.link ?? linkCli;
  const graceMs = options.graceMs ?? 300_000;
  // Allow for clock skew between this machine and Link.
  const since = Date.now() - 60_000;
  const { server, runId, observe } = createValidationServer(
    adapter,
    validations,
    (progress) => write({ event: 'progress', ...progress }),
  );
  let timer: NodeJS.Timeout | undefined;
  let poll: NodeJS.Timeout | undefined;
  let done = false;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port, '127.0.0.1', resolve);
    });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const tasks = validations.map((validation) => {
      const url = `${base}/${validation.id}`;
      return { validation: validation.id, url, task: validation.task(url) };
    });
    log(`${tasks.map((t) => t.task).join('\n')}\nWaiting for the agent.`);
    write({
      event: 'ready',
      run_id: runId,
      tasks,
      timeout_seconds: timeoutMs / 1000 || null,
      requires_human: [
        {
          step: 'approve_payment',
          description:
            'A person may need to approve test-mode spend requests, each within about 30 minutes.',
        },
      ],
      docs: 'packages/validate/README.md',
    });

    const evaluate = (validation: Validation, final: boolean) =>
      validation.evaluate(
        { observed: observe(validation.id), link, since },
        final,
      );
    // One map of settled verdicts, keyed by validation id, each with the time
    // it settled (used to grace the next validation in order).
    const finished = new Map<string, { verdict: Verdict; at: number }>();
    const settled = new Promise<void>((resolve) => {
      const tick = async () => {
        for (const [index, validation] of validations.entries()) {
          if (finished.has(validation.id)) continue;
          const prev = finished.get(validations[index - 1]?.id ?? '');
          const graceOver = !!prev && Date.now() - prev.at > graceMs;
          const verdict = await evaluate(validation, graceOver);
          if (verdict.status !== 'pending' || graceOver) {
            finished.set(validation.id, { verdict, at: Date.now() });
          }
        }
        if (finished.size === validations.length) resolve();
        else if (!done) poll = setTimeout(tick, options.pollMs ?? 5_000);
      };
      void tick();
    });
    const stopped = new Promise<Outcome>((resolve) => {
      if (timeoutMs > 0) timer = setTimeout(resolve, timeoutMs, 'timed_out');
      if (signal.aborted) resolve('interrupted');
      signal.addEventListener('abort', () => resolve('interrupted'));
    });
    const stop = await Promise.race([settled.then(() => undefined), stopped]);

    const results = [];
    for (const validation of validations) {
      const verdict =
        finished.get(validation.id)?.verdict ??
        (await evaluate(validation, true));
      results.push({
        id: validation.id,
        ...verdict,
        status:
          verdict.status === 'pending' ? (stop ?? 'timed_out') : verdict.status,
      });
    }
    const status: Outcome =
      stop === 'interrupted'
        ? 'interrupted'
        : results.some((r) => r.status === 'failed')
          ? 'failed'
          : results.some((r) => r.status === 'timed_out')
            ? 'timed_out'
            : 'passed';
    write({ event: 'result', status, run_id: runId, validations: results });
    log(`Validation ${status.replace('_', ' ')}.`);
    return exitCodes[status];
  } finally {
    done = true;
    clearTimeout(timer);
    clearTimeout(poll);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
