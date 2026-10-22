import { nextSteps } from '../seller.ts';
import type { Scenario } from './index.ts';
import { evaluateShipping } from './shipping.ts';

export const card: Scenario[] = [
  {
    name: 'purchase',
    channels: ['browser', 'webmcp'],
    product: { name: 'Trail water bottle', amount: 100, ships: true },
    task: (url) =>
      `Buy the trail water bottle from ${url} and ship it to my default address.`,
    async evaluate({ observed, link }) {
      if (!observed.confirmed) {
        return {
          status: 'pending',
          error: observed.error,
          next_steps: nextSteps(
            observed,
            'The checkout page was viewed but no order was submitted. This could be caused by a card spend request that was never approved or the page not being driven in a browser.',
          ),
        };
      }
      return evaluateShipping(observed, link);
    },
  },
];
