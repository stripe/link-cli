import type { Address } from './link.ts';
import {
  type ChannelContext,
  productLine,
  readBody,
  rejectRepeatPurchase,
} from './seller.ts';

const addressFields = [
  'name',
  'line_1',
  'line_2',
  'locality',
  'administrative_area',
  'postal_code',
  'country_code',
];

const field = (id: string, label: string, autocomplete: string) =>
  `<label>${label} <input name="${id}" autocomplete="${autocomplete}"${id === 'line_2' ? '' : ' required'}></label>`;

export function checkoutPage(context: ChannelContext, script = '') {
  return (
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>Trail Notes checkout</title>` +
    `<h1>Trail Notes</h1><p>${productLine(context)}</p>` +
    `<p>Test checkout. Use test-mode card credentials only (Link CLI: --test). No charge will be made.</p>` +
    `<form method="post" action="${context.base}/purchase">` +
    field('card_number', 'Card number', 'cc-number') +
    field('expiry', 'Expiry (MM/YY)', 'cc-exp') +
    field('cvc', 'CVC', 'cc-csc') +
    field('name', 'Name', 'name') +
    field('line_1', 'Address line 1', 'address-line1') +
    field('line_2', 'Address line 2', 'address-line2') +
    field('locality', 'City', 'address-level2') +
    field('administrative_area', 'State', 'address-level1') +
    field('postal_code', 'Postal code', 'postal-code') +
    field('country_code', 'Country code', 'country') +
    `<button type="submit">Place order</button></form>${script}</html>`
  );
}

export async function purchase(context: ChannelContext) {
  const { request, run, report, fail, send } = context;
  const { observed } = run;
  if (rejectRepeatPurchase(context)) return;
  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await readBody(request));
  } catch {
    fail(400, 'Send a form body no larger than 8 KiB.');
    return;
  }
  const card = form.get('card_number')?.replace(/[\s-]/g, '') ?? '';
  if (
    !/^\d{13,19}$/.test(card) ||
    !/^(0[1-9]|1[0-2])\/\d{2}$/.test(form.get('expiry') ?? '') ||
    !/^\d{3,4}$/.test(form.get('cvc') ?? '')
  ) {
    fail(400, 'Enter a card number, expiry (MM/YY), and CVC.');
    return;
  }
  const address = Object.fromEntries(
    addressFields.flatMap((key) => {
      const value = form.get(key)?.trim();
      return value ? [[key, value]] : [];
    }),
  );
  if (!address.line_1 || !/^[A-Za-z]{2}$/.test(address.country_code ?? '')) {
    fail(400, 'Enter a shipping address with a 2-letter country code.');
    return;
  }

  // Link's test-mode virtual card always declines in Stripe test mode, so this
  // channel checks that the agent can complete the form and charges nothing.
  // Never record or echo the full card number.
  observed.payment = { card_last4: card.slice(-4) };
  observed.shipping_address = address as Address;
  observed.confirmed = true;
  observed.error = undefined;
  report({ step: 'confirmed' });
  send(
    200,
    'text/html; charset=utf-8',
    '<!doctype html><html lang="en"><meta charset="utf-8"><title>Order placed</title><h1>Order placed</h1></html>',
  );
}
