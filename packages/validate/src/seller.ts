import { randomUUID } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { channels } from './channels/index.ts';
import type { Address } from './link.ts';
import type { Validation } from './validations/index.ts';

export type PaymentAdapter = {
  // Metadata and purchase-body credential fields shown by GET /api. The
  // `credential` fields go in the purchase request body; the rest sit
  // alongside `product` in the response.
  documentation: Record<string, unknown> & {
    credential: Record<string, string>;
  };
  // Return payment evidence only after verifying the completed test payment.
  // A terminal error means this validation can no longer pass.
  purchase(
    body: unknown,
    order: { amount: number; runId: string; idempotencyKey: string },
  ): Promise<
    | { payment: Record<string, string> }
    | { status: number; error: string; terminal?: boolean }
  >;
};

export type Progress = {
  validation: string;
  step:
    | 'api_viewed'
    | 'purchase_submitted'
    | 'purchase_rejected'
    | 'payment_verified'
    | 'confirmation_rejected'
    | 'confirmed';
  error?: string;
};

// What the seller has seen for one validation's URL.
export type Observed = {
  api_viewed: boolean;
  purchase_attempted: boolean;
  confirmed: boolean;
  payment?: Record<string, string>;
  shipping_address?: Address;
  // Latest error returned to the buyer.
  error?: string;
  // The payment was rejected; this validation can no longer pass.
  terminal_error?: string;
};

// Per-validation run state shared by the seller and its channel handlers.
export type Run = {
  validation: Validation;
  purchasing: boolean;
  confirmationToken?: string;
  observed: Observed;
};

// Everything a channel handler needs to answer one request.
export type ChannelContext = {
  request: IncomingMessage;
  response: ServerResponse;
  // Path after the validation's base path, e.g. "/", "/api", "/purchase".
  page: string;
  base: string;
  run: Run;
  runId: string;
  adapter: PaymentAdapter;
  report: (progress: Omit<Progress, 'validation'>) => void;
  send: (status: number, contentType: string, body: string) => void;
  reply: (status: number, body: unknown) => void;
  // Records the error for the validation and replies with it.
  fail: (status: number, message: string) => void;
};

export function productLine(context: ChannelContext) {
  const { product } = context.run.validation;
  return `${product.name}, $${(product.amount / 100).toFixed(2)} USD${product.ships ? ', shipped' : ''}.`;
}

export async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  // Keep the socket open so callers can reply when a body exceeds the limit.
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 8192) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString();
}

// Replies 409 and returns true once this validation has a purchase.
export function rejectRepeatPurchase({ run, reply }: ChannelContext) {
  const { observed } = run;
  if (!observed.terminal_error && !run.purchasing && !observed.payment) {
    return false;
  }
  reply(409, {
    error:
      'This validation already has a purchase. If it failed, start a new validation run.',
  });
  return true;
}

// One fixed charge per validation run, even if the buyer retries.
export function order({ run, runId }: ChannelContext) {
  const { id, product } = run.validation;
  return {
    amount: product.amount,
    runId,
    idempotencyKey: `link_validate_${runId}_${id}`,
  };
}

export const unverifiedPayment =
  'Unable to verify the test payment. Check the seller sandbox request logs, then start a new validation run.';

// The next step for an unfinished validation, from what the seller saw.
export function nextSteps(observed: Observed, viewed: string) {
  if (observed.error) return `There was an error: ${observed.error}`;
  if (observed.api_viewed) return viewed;
  return 'The seller received no requests. This could be caused by the task not reaching the agent or the seller URL being unreachable from where it runs.';
}

export function createValidationServer(
  adapter: PaymentAdapter,
  validations: Validation[],
  report: (progress: Progress) => void,
) {
  const runId = randomUUID();
  const runs = new Map<string, Run>(
    validations.map((validation) => [
      validation.id,
      {
        validation,
        purchasing: false,
        observed: {
          api_viewed: false,
          purchase_attempted: false,
          confirmed: false,
        },
      },
    ]),
  );

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

    // Each validation has its own URL, so every request maps to one validation.
    const [, id, page = '/'] =
      /^\/([a-z0-9-]+)(\/[a-z]*)?$/.exec(request.url ?? '') ?? [];
    const run = id ? runs.get(id) : undefined;
    if (!run) {
      reply(404, { error: 'Not found. Use the URL from your task.' });
      return;
    }
    const validation = run.validation.id;
    const progress = (event: Omit<Progress, 'validation'>) =>
      report({ validation, ...event });
    await channels[run.validation.channel]({
      request,
      response,
      page,
      base: `/${validation}`,
      run,
      runId,
      adapter,
      report: progress,
      send,
      reply,
      fail: (status, message) => {
        if (!run.observed.confirmed) {
          run.observed.error = message;
          progress({
            step:
              page === '/confirm'
                ? 'confirmation_rejected'
                : 'purchase_rejected',
            error: message,
          });
        }
        reply(status, { error: message });
      },
    });
  });

  const observe = (id: string): Observed => {
    const observed = runs.get(id)?.observed;
    if (!observed) throw new Error(`Unknown validation ${id}`);
    return { ...observed };
  };
  return { server, runId, observe };
}
