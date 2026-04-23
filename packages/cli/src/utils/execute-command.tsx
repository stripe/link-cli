import { LinkAuthenticationError, type LinkSdkError } from '@stripe/link-sdk';
import { render } from 'ink';
import type React from 'react';
import { ValidationError } from './json-options.js';

export function outputJson(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n\n`);
}

export function outputError(message: string, code?: string): never {
  process.stderr.write(
    `${JSON.stringify({ error: message, ...(code && { code }) })}\n`,
  );
  process.exit(1);
}

export function outputErrors(errors: string[], asJson: boolean): never {
  if (asJson) {
    process.stderr.write(`${JSON.stringify({ errors })}\n`);
  } else {
    process.stderr.write(`${errors.join('\n')}\n`);
  }
  process.exit(1);
}

export async function executeCommand<T>(opts: {
  outputJson: boolean;
  jsonFn: () => Promise<T>;
  renderFn: () => React.ReactElement;
}): Promise<void> {
  try {
    if (opts.outputJson) {
      const data = await opts.jsonFn();
      outputJson(data);
    } else if (!process.stdout.isTTY) {
      process.stderr.write('No TTY detected — falling back to JSON output.\n');
      process.stderr.write(
        "Run 'link-cli skill' to read the full Link CLI skill file.\n",
      );
      const data = await opts.jsonFn();
      outputJson(data);
    } else {
      const { waitUntilExit } = render(opts.renderFn());
      await waitUntilExit();
    }
  } catch (err) {
    if (err instanceof ValidationError) {
      outputErrors(err.errors, opts.outputJson);
    }
    if (err instanceof LinkAuthenticationError) {
      outputError(
        'Not authenticated. Please run `link login` first.',
        err.code,
      );
    }
    const sdkErr = err as LinkSdkError;
    outputError((err as Error).message, sdkErr?.code);
  }
}
