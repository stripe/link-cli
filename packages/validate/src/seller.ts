import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
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

// A record of strings, bounded by the 8 KiB request limit below.
const shippingBody = z.object({
  shipping_address: z
    .record(z.string(), z.string().max(200))
    .refine((address) => !!address.line_1, 'shipping_address requires line_1'),
});
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
  validations: Validation[],
  report: (progress: Progress) => void,
) {
  const runId = randomUUID();
  const runs = new Map(
    validations.map((validation) => [
      validation.id,
      {
        validation,
        purchasing: false,
        confirmationToken: undefined as string | undefined,
        observed: {
          api_viewed: false,
          purchase_attempted: false,
          confirmed: false,
        } as Observed,
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
    const { validation, observed } = run;
    const { product } = validation;
    const base = `/${validation.id}`;

    if (request.method === 'GET' && page === '/') {
      send(
        200,
        'text/html; charset=utf-8',
        `<!doctype html><html lang="en"><meta charset="utf-8"><title>Trail Notes</title><h1>Trail Notes</h1>` +
          `<p>${product.name}, $${(product.amount / 100).toFixed(2)} USD${product.ships ? ', shipped' : ''}.</p>` +
          `<p><a href="${base}/api">Purchase API documentation</a></p></html>`,
      );
      return;
    }
    if (request.method === 'GET' && page === '/api') {
      observed.api_viewed = true;
      report({ validation: validation.id, step: 'api_viewed' });
      const { credential, ...meta } = adapter.documentation;
      reply(200, {
        product,
        ...meta,
        purchase: {
          method: 'POST',
          path: `${base}/purchase`,
          content_type: 'application/json',
          body: {
            ...credential,
            ...(product.ships && {
              shipping_address:
                '<name, line_1, line_2, locality, administrative_area, postal_code, country_code>',
            }),
          },
        },
        ...(!validation.rejection && {
          confirmation: {
            method: 'POST',
            path: `${base}/confirm`,
            body: { confirmation_token: '<token returned by the purchase>' },
          },
        }),
      });
      return;
    }
    if (
      request.method !== 'POST' ||
      (page !== '/purchase' && page !== '/confirm')
    ) {
      reply(404, { error: 'Not found' });
      return;
    }
    const fail = (status: number, message: string) => {
      if (!observed.confirmed) {
        observed.error = message;
        report({
          validation: validation.id,
          step:
            page === '/purchase'
              ? 'purchase_rejected'
              : 'confirmation_rejected',
          error: message,
        });
      }
      reply(status, { error: message });
    };
    if (validation.rejection) {
      observed.purchase_attempted = true;
      fail(409, validation.rejection);
      return;
    }

    let body: unknown;
    try {
      body = await readJson(request);
    } catch {
      fail(400, 'Send a JSON body no larger than 8 KiB.');
      return;
    }

    if (page === '/confirm') {
      const parsed = confirmationBody.safeParse(body);
      if (
        !run.confirmationToken ||
        !parsed.success ||
        parsed.data.confirmation_token !== run.confirmationToken
      ) {
        fail(400, 'A confirmation token from this purchase is required.');
        return;
      }
      const result = { ...observed.payment, status: 'passed', run_id: runId };
      response.once('finish', () => {
        observed.confirmed = true;
        observed.error = undefined;
        report({ validation: validation.id, step: 'confirmed' });
      });
      reply(200, result);
      return;
    }

    const shipping = shippingBody.safeParse(body);
    if (product.ships && !shipping.success) {
      fail(400, `${product.name} ships. Include a shipping_address.`);
      return;
    }
    if (observed.terminal_error || run.purchasing || observed.payment) {
      reply(409, {
        error:
          'This validation already has a purchase. If it failed, start a new validation run.',
      });
      return;
    }
    if (shipping.success) {
      observed.shipping_address = shipping.data.shipping_address as Address;
    }
    run.purchasing = true;
    observed.error = undefined;
    report({ validation: validation.id, step: 'purchase_submitted' });
    const failValidation = (status: number, message: string) => {
      observed.terminal_error = message;
      fail(status, message);
    };
    try {
      const result = await adapter.purchase(body, {
        amount: product.amount,
        runId,
        idempotencyKey: `link_validate_${runId}_${validation.id}`,
      });
      if ('error' in result) {
        if (result.terminal) failValidation(result.status, result.error);
        else fail(result.status, result.error);
        return;
      }
      observed.payment = result.payment;
      run.confirmationToken = randomUUID();
      report({ validation: validation.id, step: 'payment_verified' });
      reply(200, {
        ...result.payment,
        confirmation_token: run.confirmationToken,
        product: product.name,
      });
    } catch {
      // Never echo adapter errors: they can contain payment credentials.
      failValidation(
        502,
        'Unable to verify the test payment. Check the seller request logs, then start a new validation run.',
      );
    } finally {
      run.purchasing = false;
    }
  });

  const observe = (id: string): Observed => {
    const observed = runs.get(id)?.observed;
    if (!observed) throw new Error(`Unknown validation ${id}`);
    return { ...observed };
  };
  return { server, runId, observe };
}
