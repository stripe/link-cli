import { clearScreenDown, cursorTo, moveCursor } from 'node:readline';

type Score = { passed: number; total: number };
type Task = { validation: string; task: string };
type Result = {
  id: string;
  status: string;
  error?: string;
  next_steps?: string;
};
type Row = Task & { status: string; detail?: string; finished: boolean };
type Event =
  | {
      event: 'ready';
      tasks: Task[];
      timeout_seconds: number | null;
      score: Score;
    }
  | { event: 'progress'; validation: string; step: string; error?: string }
  | ({ event: 'validation'; validation: string; score: Score } & Omit<
      Result,
      'id'
    >)
  | { event: 'result'; status: string; validations: Result[]; score: Score };

const progressStatus: Record<string, string> = {
  api_viewed: 'opened',
  purchase_submitted: 'checking',
  purchase_rejected: 'retry',
  payment_verified: 'paid',
  confirmation_rejected: 'retry',
  confirmed: 'checking',
};
const label = (value: string) =>
  value[0].toUpperCase() + value.slice(1).replaceAll('_', ' ');
// Each icon is two terminal columns wide.
const icons: Record<string, string> = {
  pending: '⏳',
  opened: '👀',
  checking: '🔄',
  retry: '🔁',
  paid: '💳',
  passed: '✅',
  failed: '❌',
  unverified: '❓',
  timed_out: '⏰',
  interrupted: '🛑',
};
const statusCell = (status: string) =>
  `${icons[status] ?? '  '} ${label(status).padEnd(11)}`;
const indent = `${' '.repeat(15)}| `;

// Wrap table cells at spaces without splitting URLs.
function wrap(text: string, width: number) {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  lines.push(line);
  return lines;
}

export function createPrinter(output: NodeJS.WriteStream = process.stdout) {
  const rows = new Map<string, Row>();
  let score: Score = { passed: 0, total: 0 };
  let timeout = 0;
  let result: string | undefined;
  let previousRows = 0;
  let previousWidth = output.columns || 80;
  let live = output.isTTY === true;
  const scoreLabel = () =>
    `Passed ${score.passed}/${score.total} (${score.total ? Math.round((100 * score.passed) / score.total) : 0}%)`;

  const draw = () => {
    const columns = output.columns || 80;
    const width = Math.max(1, columns - 18);
    const limit = timeout % 60 ? `${timeout}s` : `${timeout / 60}m`;
    const heading = result
      ? `${scoreLabel()} · ${result === 'passed' ? 'Finished' : label(result)}`
      : `${scoreLabel()}${timeout ? ` · ${limit} timeout` : ''}`;
    const lines = [
      ...wrap(heading, columns - 1),
      '',
      `${'Status'.padEnd(14)} | Validation`,
      `${'-'.repeat(15)}+-${'-'.repeat(width)}`,
    ];
    for (const row of rows.values()) {
      const [first, ...rest] = wrap(row.validation, width);
      lines.push(`${statusCell(row.status)} | ${first}`);
      for (const line of rest) lines.push(`${indent}${line}`);
      if (row.detail) {
        for (const line of wrap(row.detail, width))
          lines.push(`${indent}${line}`);
      }
    }
    const physicalRows = lines.reduce(
      (count, line) => count + Math.max(1, Math.ceil(line.length / columns)),
      0,
    );
    // A tall table or resize can scroll earlier output out of reach of the cursor.
    if (physicalRows >= (output.rows || 24) || columns !== previousWidth)
      live = false;
    if (live && previousRows) {
      moveCursor(output, 0, -previousRows);
      cursorTo(output, 0);
      clearScreenDown(output);
    }
    output.write(`${lines.join('\n')}\n`);
    previousRows = physicalRows;
    previousWidth = columns;
  };

  return (raw: Record<string, unknown>) => {
    const event = raw as Event;
    if (event.event === 'ready') {
      for (const task of event.tasks) {
        rows.set(task.validation, {
          ...task,
          status: 'pending',
          finished: false,
        });
      }
      score = event.score;
      timeout = event.timeout_seconds ?? 0;
      // Let the terminal soft-wrap prompts so copying preserves their text.
      output.write(
        `Run prompts in any order.\n\n${event.tasks.map(({ task }) => task).join('\n\n')}\n\n`,
      );
      draw();
    } else if (event.event === 'result') {
      for (const verdict of event.validations) {
        const row = rows.get(verdict.id);
        if (row)
          Object.assign(row, {
            status: verdict.status,
            detail: verdict.next_steps ?? verdict.error,
            finished: true,
          });
      }
      score = event.score;
      result = event.status;
      draw();
    } else if (event.event === 'progress' || event.event === 'validation') {
      const row = rows.get(event.validation);
      if (!row || row.finished) return;
      if (event.event === 'progress') {
        const status = progressStatus[event.step];
        if (!status || (row.status === status && row.detail === event.error))
          return;
        row.status = status;
        row.detail = event.error;
      } else {
        row.status = event.status;
        row.detail = event.next_steps ?? event.error;
        row.finished = true;
        score = event.score;
      }
      if (live) draw();
      else
        output.write(
          `${event.validation}: ${label(row.status)}${row.finished ? ` · ${scoreLabel()}` : ''}${row.detail ? ` — ${row.detail}` : ''}\n`,
        );
    }
  };
}
