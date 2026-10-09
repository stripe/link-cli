import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';

export type PaymentAdapter = {
  // Guidance for fixing a buyer that has not completed the purchase.
  fixInstructions: string;
  documentation: Record<string, unknown>;
  // Return payment evidence only after verifying the completed test payment.
  // A terminal error means this run can no longer pass.
  purchase(
    body: unknown,
    runId: string,
  ): Promise<
    | { payment: Record<string, string> }
    | { status: number; error: string; terminal?: boolean }
  >;
};

type ProgressStep =
  | 'api_viewed'
  | 'purchase_submitted'
  | 'purchase_rejected'
  | 'payment_verified'
  | 'confirmation_rejected'
  | 'confirmed';
export type Progress = { step: ProgressStep; error?: string };
export type RunSnapshot = {
  error?: string;
  api_viewed: boolean;
  paid: boolean;
};
type ValidationResult =
  | (Record<string, string> & { status: 'passed'; run_id: string })
  | { status: 'failed'; run_id: string; error: string };

const product = 'Digital trail guide';
const confirmationBody = z.object({ confirmation_token: z.string() });

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}

export function createValidationServer(
  adapter: PaymentAdapter,
  report: (progress: Progress) => void,
) {
  const runId = randomUUID();
  let apiViewed = false;
  let purchasing = false;
  let confirmed = false;
  let failed = false;
  let lastError: string | undefined;
  let purchase:
    | { payment: Record<string, string>; confirmation_token: string }
    | undefined;
  let finish!: (result: ValidationResult) => void;
  const completed = new Promise<ValidationResult>((resolve) => {
    finish = resolve;
  });

  const snapshot = (): RunSnapshot => ({
    error: confirmed ? undefined : lastError,
    api_viewed: apiViewed,
    paid: Boolean(purchase),
  });

  const server = createServer(async (request, response) => {
    const send = (status: number, contentType: string, body: string) => {
      response.writeHead(status, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
      });
      response.end(body);
    };
    const reply = (status: number, body: unknown) =>
      send(status, 'application/json', JSON.stringify(body));
    // URL drops the default port, so these match canonical Host/Origin headers.
    const local = new URL(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    );
    // This server uses seller credentials; only same-origin browsers or local
    // API clients may submit purchases. Also reject DNS-rebinding hostnames.
    if (
      request.headers.host !== local.host ||
      (request.headers.origin && request.headers.origin !== local.origin)
    ) {
      reply(403, {
        error:
          'Use the local seller URL printed by the validator. The seller accepts only 127.0.0.1 requests from this machine.',
      });
      return;
    }

    if (request.method === 'GET' && request.url === '/') {
      send(
        200,
        'text/html; charset=utf-8',
        '<!doctype html><html lang="en"><meta charset="utf-8">' +
          '<title>Trail Notes</title><h1>Trail Notes</h1>' +
          '<p>Buy our digital trail guide for $1.00 USD.</p>' +
          '<p><a href="/api">Purchase API documentation</a></p></html>',
      );
      return;
    }
    if (request.method === 'GET' && request.url === '/api') {
      apiViewed = true;
      report({ step: 'api_viewed' });
      reply(200, {
        product,
        ...adapter.documentation,
        confirmation: {
          method: 'POST',
          path: '/confirm',
          body: { confirmation_token: '<token returned by the purchase>' },
        },
      });
      return;
    }
    if (
      request.method !== 'POST' ||
      (request.url !== '/purchase' && request.url !== '/confirm')
    ) {
      reply(404, { error: 'Not found' });
      return;
    }
    const fail = (status: number, message: string) => {
      if (!confirmed) {
        lastError = message;
        report({
          step:
            request.url === '/purchase'
              ? 'purchase_rejected'
              : 'confirmation_rejected',
          error: message,
        });
      }
      reply(status, { error: message });
    };
    if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
      fail(415, 'Send application/json.');
      return;
    }

    let body: unknown;
    try {
      body = await readJson(request);
    } catch {
      fail(400, 'Send a JSON body no larger than 8 KiB.');
      return;
    }

    if (request.url === '/confirm') {
      const parsed = confirmationBody.safeParse(body);
      if (
        !purchase ||
        !parsed.success ||
        parsed.data.confirmation_token !== purchase.confirmation_token
      ) {
        fail(400, 'A confirmation token from this purchase is required.');
        return;
      }
      const result = {
        ...purchase.payment,
        status: 'passed' as const,
        run_id: runId,
      };
      response.once('finish', () => {
        confirmed = true;
        lastError = undefined;
        report({ step: 'confirmed' });
        finish(result);
      });
      reply(200, result);
      return;
    }

    if (failed || purchasing || purchase) {
      reply(409, {
        error:
          'This run already has a purchase. If it failed, start a new validation run.',
      });
      return;
    }
    purchasing = true;
    lastError = undefined;
    report({ step: 'purchase_submitted' });
    const failRun = (status: number, message: string) => {
      failed = true;
      fail(status, message);
      finish({ status: 'failed', run_id: runId, error: message });
    };
    try {
      const result = await adapter.purchase(body, runId);
      if ('error' in result) {
        if (result.terminal) failRun(result.status, result.error);
        else fail(result.status, result.error);
        return;
      }
      purchase = {
        payment: result.payment,
        confirmation_token: randomUUID(),
      };
      report({ step: 'payment_verified' });
      reply(200, {
        ...purchase.payment,
        confirmation_token: purchase.confirmation_token,
        product,
        content: 'Take the lakeside trail to the north overlook.',
      });
    } catch {
      // Never echo adapter errors: they can contain payment credentials.
      failRun(
        502,
        'Unable to verify the test payment. Check the seller request logs, then start a new validation run.',
      );
    } finally {
      purchasing = false;
    }
  });

  return { server, completed, runId, snapshot };
}
