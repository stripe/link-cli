import {
  DEMO_CARD_AMOUNT,
  DEMO_CLIMATE_API_URL,
  DEMO_SPT_AMOUNT,
} from './constants';

const cardAmount = `$${(DEMO_CARD_AMOUNT / 100).toFixed(2)}`;
const sptAmount = `$${(DEMO_SPT_AMOUNT / 100).toFixed(2)}`;

// ---------------------------------------------------------------------------
// Card flow
// ---------------------------------------------------------------------------

export const CARD_FLOW = {
  title: 'Flow 1: Virtual Card',

  intro: {
    description: `An agent buys a Merino Trail Jacket (${cardAmount}) from Galtee Outdoor using a **virtual card** — a one-time card number issued from your Link wallet. Your real payment details are never shared with the agent or the business.`,
    steps: [
      `The agent calls \`spend-request create\` to request ${cardAmount} at Galtee Outdoor`,
      'You approve in the Link app',
      'Link issues a one-time virtual card',
      'Open the checkout page and enter the card details',
    ],
    prompt: 'Press [Enter] to start',
  },

  createSpend: {
    description: `\`spend-request create\` sends the business name, URL, amount (${cardAmount}), and purchase description to Link. No credentials are issued until you approve.`,
    loading: 'Creating spend request...',
  },

  approval: {
    description:
      'Open the URL to approve the spend request. The CLI polls and continues once approved.',
    loading: 'Waiting for approval...',
    browserHint: 'Press [Enter] to open in browser',
  },

  showCard: {
    description:
      'Link issued a one-time virtual card. An agent fills these into the checkout form. Single-use — expires in minutes:',
    openUrl: 'Open Galtee Outdoor and enter these details at checkout.',
    prompt: 'Press [Enter] to open Galtee Outdoor',
  },

  done: {
    success: 'Opened Galtee Outdoor in your browser',
    detail:
      'Enter the card details above at checkout. Galtee Outdoor runs in testmode — no real charge.',
  },
};

// ---------------------------------------------------------------------------
// SPT flow
// ---------------------------------------------------------------------------

export const SPT_FLOW = {
  title: 'Flow 2: Machine Payment (SPT)',

  intro: {
    description:
      'Some APIs accept payment without a checkout form. When called without credentials, the server responds with **HTTP 402** and a payment challenge. The agent signs that challenge with a **shared payment token** (SPT) and retries — this is the Machine Payment Protocol (MPP).',
    preamble: `A ${sptAmount} donation to Stripe Climate (climate.stripe.dev) demonstrates:`,
    steps: [
      'Probe the API — server responds HTTP 402 with a challenge',
      'Decode the challenge to extract the `network_id`',
      'Call `spend-request create` for an SPT credential',
      'Approve the spend request',
      '`mpp pay` signs the challenge and retries with an Authorization header',
    ],
    prompt: 'Press [Enter] to start',
  },

  probe: {
    description: `The agent POSTs to ${DEMO_CLIMATE_API_URL}. Without a payment credential, the server returns HTTP 402 with a \`WWW-Authenticate\` challenge header.`,
    loading: 'Probing...',
    detail:
      'The challenge contains a **network_id** — the business identifier on the Stripe network. The agent uses it to request the matching SPT credential.',
  },

  createSpend: {
    description: `\`spend-request create\` with \`credential_type: "shared_payment_token"\`, the decoded \`network_id\`, and amount (${sptAmount}). The \`network_id\` identifies the business — no name or URL needed.`,
    loading: 'Creating spend request...',
  },

  approval: {
    description:
      'Approve the spend request. Once approved, Link issues an SPT the agent uses to sign the 402 challenge.',
    loading: 'Waiting for approval...',
    browserHint: 'Press [Enter] to open in browser',
  },

  mppPay: {
    description:
      '`mpp pay` retrieves the SPT, re-probes the API, signs the 402 challenge, and retries with an `Authorization: Payment` header.',
    loading: 'Completing payment...',
    prompt: 'Press [Enter] to pay',
  },

  done: {
    success: 'Payment complete',
    detail: `The ${sptAmount} donation went through entirely via API — no forms, no browser.`,
  },
};

// ---------------------------------------------------------------------------
// Demo runner (menu + transitions)
// ---------------------------------------------------------------------------

export const DEMO_MENU = {
  title: 'Link CLI Demo',
  subtitle:
    'Two flows showing how agents request and use payment credentials with Link.',
  question: 'Which flow would you like to run?',
  hint: 'Use ↑↓ to select, [Enter] to confirm',

  options: [
    {
      key: 'both' as const,
      label: 'Both flows',
      description: 'Walk through both flows end-to-end.',
    },
    {
      key: 'card' as const,
      label: 'Virtual card',
      description:
        'The agent requests a one-time card number and fills it into a checkout form.',
    },
    {
      key: 'spt' as const,
      label: 'Machine payment (SPT)',
      description:
        'The agent pays via API using the Machine Payment Protocol — no browser, no forms.',
    },
  ],

  transition:
    'Virtual card flow done. Next: **machine payment** — the agent pays an API directly, no checkout form needed.',
  transitionPrompt: 'Press [Enter] to continue to Flow 2',
};

// ---------------------------------------------------------------------------
// Onboard runner
// ---------------------------------------------------------------------------

export const ONBOARD = {
  title: 'Welcome to Link CLI',
  subtitle:
    'Set up Link CLI to let agents make secure payments on your behalf.',

  auth: {
    alreadyLoggedIn: 'Already logged in',
    authenticated: 'Authenticated',
    clientName: 'Link CLI Onboard',
  },

  paymentMethods: {
    loading: 'Checking payment methods...',
    pickPrompt: 'Which payment method should we use for the demo?',
    pickHint: 'Use ↑↓ to select, [Enter] to confirm',
    missing: 'No payment methods found in your Link wallet.',
    missingSteps: [
      'Open the Link app or visit link.com',
      'Add a payment method',
      'Come back here and press [Enter] to retry',
    ],
    retryPrompt: 'Press [Enter] to retry',
  },

  appTip: {
    title: 'Get the Link app',
    description:
      'Approve spend requests from your phone. Push notifications let you approve or deny instantly.',
    url: 'https://link.com/download',
  },
};
