import { Cli, z } from 'incur';
import React from 'react';
import { renderInteractive } from '../../utils/render-interactive';
import type { InspectResult } from './inspect';
import { runInspect } from './inspect';
import { InspectView } from './inspect-view';
import { inspectOptions } from './schema';

export function createInspectCli() {
  const cli = Cli.create('inspect', {
    description:
      'Inspect a URL for supported agent payment strategies (UCP, MPP/x402, Link Pay Token) and recommend one',
    args: z.object({
      url: z.string().describe('URL to inspect'),
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

      return runInspect(url, { timeoutMs });
    },
  });

  return cli;
}
