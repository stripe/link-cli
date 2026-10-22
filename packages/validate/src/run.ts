import type { AddressInfo } from 'node:net';
import { approveSpendRequests, type LinkCli, linkCli } from './link.ts';
import { createValidationServer, type PaymentAdapter } from './seller.ts';
import { sptNetworkId } from './spt.ts';
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
  validations?: Validation[];
  link?: LinkCli;
  pollMs?: number;
}): Promise<number> {
  const { adapter, timeoutMs, signal, write } = options;
  const validations = options.validations ?? defaultValidations;
  const link = options.link ?? linkCli;
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
      return {
        validation: validation.id,
        channel: validation.channel,
        url,
        task: `${validation.task(url)} Use test-mode payment credentials only (Link CLI: --test).`,
      };
    });
    write({
      event: 'ready',
      run_id: runId,
      tasks,
      score: { passed: 0, total: validations.length },
      timeout_seconds: timeoutMs / 1000 || null,
      docs: 'packages/validate/README.md',
    });

    const evaluate = (validation: Validation, final: boolean) =>
      validation.evaluate(
        { observed: observe(validation.id), link, since },
        final,
      );
    const finished = new Map<string, Verdict>();
    const score = (verdicts: Iterable<{ status: string }>) => ({
      passed: Array.from(verdicts).filter((v) => v.status === 'passed').length,
      total: validations.length,
    });
    const approved = new Set<string>();
    const settled = new Promise<void>((resolve) => {
      const tick = async () => {
        await approveSpendRequests(
          link,
          { networkId: sptNetworkId, sellerUrl: base, since },
          approved,
        );
        if (done) return;
        for (const validation of validations) {
          if (finished.has(validation.id)) continue;
          const verdict = await evaluate(validation, false);
          if (done) return;
          if (verdict.status !== 'pending') {
            finished.set(validation.id, verdict);
            write({
              event: 'validation',
              validation: validation.id,
              ...verdict,
              score: score(finished.values()),
            });
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
    done = true;

    const results = [];
    for (const validation of validations) {
      const verdict =
        finished.get(validation.id) ?? (await evaluate(validation, true));
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
    write({
      event: 'result',
      status,
      run_id: runId,
      validations: results,
      score: score(results),
    });
    return exitCodes[status];
  } finally {
    done = true;
    clearTimeout(timer);
    clearTimeout(poll);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
