import { randomBytes } from 'node:crypto';
import { Receipt } from 'mppx';
import { Request as HttpRequest, Mppx } from 'mppx/server';
import { charge } from 'mppx/stripe/server/spt';
import {
  type ChannelContext,
  order,
  type Run,
  rejectRepeatPurchase,
  unverifiedPayment,
} from '../seller.ts';
import { sptNetworkId, unconfirmedPayment } from '../spt.ts';

// mppx's handler type is generic over its configured methods; this is the
// part this channel uses.
type ChargeHandler = (
  options: Record<string, never>,
) => (
  request: Request,
) => Promise<
  | { status: 402; challenge: Response }
  | { status: 200; withReceipt: (response: Response) => Response }
>;

// mppx binds each challenge to the instance that issued it, so the 402 and the
// paid retry must use the same one.
const handlers = new WeakMap<Run, ChargeHandler>();

function chargeHandler(context: ChannelContext) {
  const { run, adapter } = context;
  const cached = handlers.get(run);
  if (cached) return cached;
  const { product } = run.validation;
  // mppx checks the challenge and credential; the SPT is redeemed through the
  // adapter, as on every other channel.
  const client = {
    paymentIntents: {
      async create(params: { shared_payment_granted_token: string }) {
        const result = await adapter.purchase(
          { spt: params.shared_payment_granted_token },
          order(context),
        );
        if (!('payment' in result)) throw new Error('Payment not verified');
        return { id: result.payment.payment_intent, status: 'succeeded' };
      },
    },
  };
  const mppx = Mppx.create({
    methods: [
      charge({
        client,
        networkId: sptNetworkId,
        paymentMethodTypes: ['card'],
        // mppx takes major units and encodes minor units in the challenge.
        amount: (product.amount / 100).toFixed(2),
        currency: 'usd',
        decimals: 2,
        description:
          'Test-mode payment only. Create a test payment credential (Link CLI: --test).',
      }),
    ],
    secretKey: randomBytes(32).toString('hex'),
  });
  const handler = mppx.charge as unknown as ChargeHandler;
  handlers.set(run, handler);
  return handler;
}

// The paid resource is GET /. Without a credential mppx answers 402 with a
// challenge; the retry carries `Authorization: Payment ...`.
export async function mpp(context: ChannelContext) {
  const { request, response, page, run, report, send, reply, fail } = context;
  const { observed, validation } = run;
  if (request.method !== 'GET' || page !== '/') {
    reply(404, { error: 'Not found' });
    return;
  }
  if (rejectRepeatPurchase(context)) return;

  const paid = request.headers.authorization !== undefined;
  run.purchasing = true;
  try {
    const result = await chargeHandler(context)({})(
      HttpRequest.fromNodeListener(request, response),
    );
    if (result.status === 402 && !paid) {
      observed.api_viewed = true;
      report({ step: 'api_viewed' });
      response.setHeader(
        'WWW-Authenticate',
        result.challenge.headers.get('WWW-Authenticate') ?? '',
      );
      reply(402, {
        error: `${validation.product.name} requires a test-mode payment.`,
        test_mode: true,
      });
      return;
    }
    if (result.status === 402) {
      // SPTs are one-time use, so a rejected credential can't be retried.
      observed.terminal_error = unconfirmedPayment;
      fail(422, observed.terminal_error);
      return;
    }
    const receipt = result.withReceipt(new Response());
    response.setHeader(
      'Payment-Receipt',
      receipt.headers.get('Payment-Receipt') ?? '',
    );
    observed.payment = {
      payment_intent: Receipt.fromResponse(receipt).reference,
    };
    report({ step: 'payment_verified' });
    send(
      200,
      'application/json',
      JSON.stringify({ report: 'Trail conditions look great today.' }),
    );
  } catch {
    // Never echo payment errors; they can contain credentials.
    observed.terminal_error = unverifiedPayment;
    fail(502, observed.terminal_error);
  } finally {
    run.purchasing = false;
  }
}
