import { Cli, z } from 'incur';
import { renderInteractive } from '../../utils/render-interactive';
import { type InspectResult, runInspect } from './inspect';
import { InspectView } from './inspect-view';
import { inspectOptions } from './schema';

export function createInspectCli(options: { userAgent?: string } = {}) {
  const cli = Cli.create('inspect', {
    description:
      'Retrieve merchant documentation, agent integrations, and payment mechanisms from the Directory API',
    args: z.object({
      url: z.string().describe('HTTP(S) merchant URL or domain to inspect'),
    }),
    options: inspectOptions,
    outputPolicy: 'agent-only' as const,
    async run(c) {
      const { url } = c.args;
      const timeoutMs = c.options.timeout;

      if (!c.agent && !c.formatExplicit) {
        let capturedResult: InspectResult | null = null;
        return renderInteractive(
          <InspectView
            url={url}
            timeoutMs={timeoutMs}
            userAgent={options.userAgent}
            onComplete={(result) => {
              capturedResult = result;
            }}
          />,
          () => {
            if (!capturedResult)
              throw new Error('Component exited without producing a result');
            return capturedResult;
          },
        );
      }

      return runInspect(url, { timeoutMs, userAgent: options.userAgent });
    },
  });

  return cli;
}
