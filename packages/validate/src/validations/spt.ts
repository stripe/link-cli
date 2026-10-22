import { findSpendRequest } from '../link.ts';
import { nextSteps, type Observed } from '../seller.ts';
import { sptNetworkId } from '../spt.ts';
import type { Scenario, Verdict } from './index.ts';
import { evaluateShipping } from './shipping.ts';

function apiNextSteps(observed: Observed) {
  if (observed.payment) {
    return 'The payment succeeded but the purchase was never confirmed. This could be caused by the confirmation token not being sent to the confirmation endpoint.';
  }
  return nextSteps(
    observed,
    'The API was viewed but the transaction was never completed. This could be caused by a spend request that was never approved or a timeout.',
  );
}

// SPTs are one-time use, so a rejected payment ends the validation.
function rejectedPayment(observed: Observed): Verdict {
  return {
    status: 'failed',
    error: observed.terminal_error,
    next_steps:
      'The payment was rejected, so this run cannot pass. This could be caused by an SPT for a different network ID or amount.',
  };
}

const cancelProduct = { name: 'Field guide', amount: 200, ships: false };

export const spt: Scenario[] = [
  {
    name: 'purchase',
    channels: ['api'],
    product: { name: 'Printed trail map', amount: 100, ships: true },
    task: (url) =>
      `Buy the printed trail map from ${url}, ship it to my default address, and confirm your purchase.`,
    async evaluate({ observed, link }) {
      if (observed.terminal_error) return rejectedPayment(observed);
      if (!observed.confirmed) {
        return {
          status: 'pending',
          error: observed.error,
          next_steps: apiNextSteps(observed),
        };
      }
      return evaluateShipping(observed, link);
    },
  },
  {
    name: 'purchase',
    channels: ['mpp'],
    product: { name: 'Trail conditions report', amount: 100, ships: false },
    task: (url) => `Get the trail conditions report from ${url}.`,
    async evaluate({ observed }) {
      if (observed.terminal_error) return rejectedPayment(observed);
      if (observed.payment) {
        return { status: 'passed', ...observed.payment };
      }
      return {
        status: 'pending',
        error: observed.error,
        next_steps: nextSteps(
          observed,
          'The paid resource was requested but never paid for. This could be caused by the client not handling HTTP 402 Payment Required with a Stripe payment method.',
        ),
      };
    },
  },
  {
    name: 'cancel',
    channels: ['api'],
    // The price identifies this validation's spend request in Link.
    product: cancelProduct,
    // The purchase is refused, so the spend request should be canceled.
    rejection: 'We are out of stock. Your payment was not processed.',
    task: (url) => `Buy the field guide from ${url}.`,
    async evaluate({ observed, link, since }, final) {
      const found = await findSpendRequest(link, {
        networkId: sptNetworkId,
        amount: cancelProduct.amount,
        since,
      });
      if (!found.available) {
        return {
          status: 'unverified',
          next_steps:
            'link-cli could not list spend requests, so the cancellation could not be checked. This could be caused by link-cli not being logged in.',
        };
      }
      if (found.request?.status === 'canceled') {
        return observed.purchase_attempted
          ? { status: 'passed' }
          : {
              status: 'failed',
              error:
                'The spend request was canceled before any payment was attempted.',
            };
      }
      if (!final) return { status: 'pending' };
      return found.request
        ? {
            status: 'pending',
            error: `The purchase was refused as out of stock, but the spend request was ${found.request.status}, not canceled.`,
          }
        : {
            status: 'unverified',
            next_steps:
              "No spend request for this task was found. This could be caused by the request not being created, or by a different Link login than link-cli's on this machine.",
          };
    },
  },
];
