import { checkoutPage, purchase } from '../checkout.ts';
import type { ChannelContext } from '../seller.ts';

// Card checkout form: GET / (checkout page), POST /purchase.
export async function browser(context: ChannelContext) {
  const { request, page, run, report, send, reply } = context;
  if (request.method === 'GET' && page === '/') {
    run.observed.api_viewed = true;
    report({ step: 'api_viewed' });
    send(200, 'text/html; charset=utf-8', checkoutPage(context));
    return;
  }
  if (request.method === 'POST' && page === '/purchase') {
    await purchase(context);
    return;
  }
  reply(404, { error: 'Not found' });
}
