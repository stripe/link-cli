import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Address } from '../link.ts';
import {
  type ChannelContext,
  order,
  productLine,
  readBody,
  rejectRepeatPurchase,
  unverifiedPayment,
} from '../seller.ts';

// A record of strings, bounded by the 8 KiB request limit.
const shippingBody = z.object({
  shipping_address: z
    .record(z.string(), z.string().max(200))
    .refine((address) => !!address.line_1, 'shipping_address requires line_1'),
});
const confirmationBody = z.object({ confirmation_token: z.string() });

async function readJson(context: ChannelContext) {
  try {
    return JSON.parse(await readBody(context.request)) as unknown;
  } catch {
    context.fail(400, 'Send a JSON body no larger than 8 KiB.');
    return undefined;
  }
}

// Charges an SPT purchase body for this validation's product and replies with
// the payment evidence and a confirmation token.
async function purchase(context: ChannelContext, body: unknown) {
  const { run, adapter, report, reply, fail } = context;
  const { validation, observed } = run;
  const { product } = validation;
  if (validation.rejection) {
    observed.purchase_attempted = true;
    fail(409, validation.rejection);
    return;
  }
  const shipping = shippingBody.safeParse(body);
  if (product.ships && !shipping.success) {
    fail(400, `${product.name} ships. Include a shipping_address.`);
    return;
  }
  if (rejectRepeatPurchase(context)) return;
  if (shipping.success) {
    observed.shipping_address = shipping.data.shipping_address as Address;
  }
  run.purchasing = true;
  observed.error = undefined;
  report({ step: 'purchase_submitted' });
  const failValidation = (status: number, message: string) => {
    observed.terminal_error = message;
    fail(status, message);
  };
  try {
    const result = await adapter.purchase(body, order(context));
    if ('error' in result) {
      if (result.terminal) failValidation(result.status, result.error);
      else fail(result.status, result.error);
      return;
    }
    observed.payment = result.payment;
    run.confirmationToken = randomUUID();
    report({ step: 'payment_verified' });
    reply(200, {
      ...result.payment,
      confirmation_token: run.confirmationToken,
      product: product.name,
    });
  } catch {
    // Never echo adapter errors: they can contain payment credentials.
    failValidation(502, unverifiedPayment);
  } finally {
    run.purchasing = false;
  }
}

async function confirm(context: ChannelContext, body: unknown) {
  const { run, runId, report, reply, fail, response } = context;
  const parsed = confirmationBody.safeParse(body);
  if (
    !run.confirmationToken ||
    !parsed.success ||
    parsed.data.confirmation_token !== run.confirmationToken
  ) {
    fail(400, 'A confirmation token from this purchase is required.');
    return;
  }
  response.once('finish', () => {
    run.observed.confirmed = true;
    run.observed.error = undefined;
    report({ step: 'confirmed' });
  });
  reply(200, { ...run.observed.payment, status: 'passed', run_id: runId });
}

// Direct JSON API: GET / (store page), GET /api (docs), POST /purchase, /confirm.
export async function api(context: ChannelContext) {
  const { request, page, base, run, adapter, report, send, reply } = context;
  const { validation, observed } = run;
  if (request.method === 'GET' && page === '/') {
    send(
      200,
      'text/html; charset=utf-8',
      `<!doctype html><html lang="en"><meta charset="utf-8"><title>Trail Notes</title><h1>Trail Notes</h1>` +
        `<p>${productLine(context)}</p><p><a href="${base}/api">Purchase API documentation</a></p></html>`,
    );
    return;
  }
  if (request.method === 'GET' && page === '/api') {
    observed.api_viewed = true;
    report({ step: 'api_viewed' });
    const { credential, ...meta } = adapter.documentation;
    reply(200, {
      product: validation.product,
      ...meta,
      purchase: {
        method: 'POST',
        path: `${base}/purchase`,
        content_type: 'application/json',
        body: {
          ...credential,
          ...(validation.product.ships && {
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
  if (validation.rejection && page === '/purchase') {
    await purchase(context, undefined);
    return;
  }
  const body = await readJson(context);
  if (body === undefined) return;
  if (page === '/confirm') await confirm(context, body);
  else await purchase(context, body);
}
