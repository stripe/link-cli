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
    description: `Agent buys a Errigal Puffer Jacket (${cardAmount}) with a one-time virtual card from your Link wallet. Your real card is never shared.`,
    steps: [
      'Select payment method',
      `Create spend request for ${cardAmount}`,
      'Approve in Link',
      'Get virtual card and open checkout',
    ],
    prompt: 'Press [Enter] to start',
  },

  createSpend: {
    description: `Requests ${cardAmount} from your wallet. No credentials issued until you approve.`,
    loading: 'Creating spend request...',
  },

  approval: {
    description: 'Open the URL to approve. CLI continues once approved.',
    loading: 'Waiting for approval...',
    browserHint: 'Press [Enter] to open in browser',
  },

  showCard: {
    description:
      'One-time virtual card issued. Enter these at Galtee Outdoor checkout:',
    prompt: 'Press [Enter] to open Galtee Outdoor',
  },

  done: {
    success: 'Opened Galtee Outdoor in your browser',
    detail: 'Testmode — no real charge.',
  },
};

// ---------------------------------------------------------------------------
// SPT flow
// ---------------------------------------------------------------------------

export const SPT_FLOW = {
  title: 'Flow 2: Machine Payment (SPT)',

  intro: {
    description:
      "No checkout form. Server returns **HTTP 402** with a payment challenge; the agent signs it with a **shared payment token** (SPT) and retries. That's the Machine Payment Protocol.",
    preamble: `${sptAmount} donation to Stripe Climate demonstrates:`,
    steps: [
      'Select payment method',
      'Probe API — get HTTP 402 challenge and decode `network_id`',
      'Create SPT spend request',
      'Approve',
      '`mpp pay` signs and retries',
    ],
    prompt: 'Press [Enter] to start',
  },

  probe: {
    description: `POST to ${DEMO_CLIMATE_API_URL} without credentials — server returns 402 with a \`WWW-Authenticate\` challenge.`,
    loading: 'Probing...',
    detail:
      "Challenge contains a `network_id` — the business identifier on Stripe's network.",
  },

  createSpend: {
    description: `Request an SPT using the decoded \`network_id\` and amount (${sptAmount}).`,
    loading: 'Creating spend request...',
  },

  approval: {
    description: 'Approve to issue the SPT.',
    loading: 'Waiting for approval...',
    browserHint: 'Press [Enter] to open in browser',
  },

  mppPay: {
    description:
      '`mpp pay` retrieves the SPT, signs the challenge, retries with `Authorization: Payment`.',
    loading: 'Completing payment...',
    prompt: 'Press [Enter] to pay',
  },

  done: {
    success: 'Payment complete',
    detail: `${sptAmount} donation completed via API — no forms, no browser.`,
  },
};

// ---------------------------------------------------------------------------
// Demo runner (menu + transitions)
// ---------------------------------------------------------------------------

export const DEMO_MENU = {
  title: 'Link CLI Demo',
  subtitle: 'See how agents use Link to make payments.',
  question: 'Which flow would you like to run?',
  hint: 'Use ↑↓ to select, [Enter] to confirm',

  options: [
    {
      key: 'both' as const,
      label: 'Both flows',
      description: 'Run both end-to-end.',
    },
    {
      key: 'card' as const,
      label: 'Virtual card',
      description: 'One-time card number for checkout forms.',
    },
    {
      key: 'spt' as const,
      label: 'Machine payment (SPT)',
      description: 'Pay via API — no browser, no forms.',
    },
  ],

  transition:
    'Card flow done. Next: **machine payment** — paying an API directly.',
  transitionPrompt: 'Press [Enter] to continue to Flow 2',
};

// ---------------------------------------------------------------------------
// Onboard runner
// ---------------------------------------------------------------------------

export const ONBOARD = {
  title: 'Welcome to Link CLI',
  subtitle: 'Let agents make secure payments on your behalf.',

  auth: {
    alreadyLoggedIn: 'Already logged in',
    authenticated: 'Authenticated',
    clientName: 'Link CLI Onboard',
  },

  paymentMethods: {
    loading: 'Checking payment methods...',
    pickPrompt: 'Which payment method should we use for the demo?',
    pickHint: 'Use ↑↓ to select, [Enter] to confirm',
    missing: 'No payment methods in your Link wallet.',
    missingSteps: [
      'Open the Link app or visit link.com',
      'Add a payment method',
      'Press [Enter] to retry',
    ],
    retryPrompt: 'Press [Enter] to retry',
  },

  appTip: {
    title: 'Get the Link app',
    description:
      'Approve spend requests from your phone with push notifications.',
    url: 'https://link.com/download',
  },
};
