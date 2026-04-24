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
    description:
      'This flow demonstrates how an agent buys something on a website with a traditional checkout form. The agent will request a **virtual card** from your Link wallet — a one-time-use card number that expires in minutes. Your real card details are never shared with the agent or the merchant.',
    steps: [
      'Create a "spend request" — the agent\'s way of asking permission to spend',
      "You'll approve it in the Link app",
      'Link generates a virtual card the agent can use',
      "We'll open a checkout page so you can see the card in action",
    ],
    prompt: 'Press [Enter] to start',
  },

  createSpend: {
    description: `Step 1: The agent calls \`spend-request create\` with the merchant name, URL, amount (${cardAmount}), and a description of why it's spending. This creates a spend request that needs your approval before any credentials are issued.`,
    loading: 'Creating...',
  },

  approval: {
    description:
      'Step 2: You need to approve this spend request. Open the link below, review the details, and approve. The agent is polling in the background and will continue automatically once you approve.',
    loading: 'Waiting for approval...',
    browserHint: 'Press [Enter] to open in browser',
  },

  showCard: {
    description:
      "Step 3: Link generated a one-time virtual card. These credentials are what the agent receives — it would fill them into the merchant's checkout form to complete the purchase:",
    openUrl:
      "Step 4: Let's open a real checkout page so you can try entering these card details yourself — just like an agent would.",
    prompt: 'Press [Enter] to open the payment page',
  },

  done: {
    success: 'Opened the payment page in your browser',
    detail:
      'Enter the card details above into the checkout form to complete the purchase.',
  },
};

// ---------------------------------------------------------------------------
// SPT flow
// ---------------------------------------------------------------------------

export const SPT_FLOW = {
  title: 'Flow 2: Machine Payment (SPT)',

  intro: {
    description:
      'Not all merchants have checkout forms. Some accept payment entirely via API — an agent sends an HTTP request, the server responds with **HTTP 402 Payment Required** and a payment challenge, and the agent pays by signing that challenge with a **shared payment token** (SPT). This is called the Machine Payment Protocol (MPP).',
    preamble: `We'll make a ${sptAmount} donation to Stripe Climate (climate.stripe.dev) to demonstrate:`,
    steps: [
      'Probe the API to trigger the 402 challenge',
      "Decode the challenge to get the merchant's network ID",
      'Create a spend request for an SPT credential',
      "You'll approve it",
      'The agent completes payment automatically via the API',
    ],
    prompt: 'Press [Enter] to start',
  },

  probe: {
    description: `Step 1: The agent sends a POST to ${DEMO_CLIMATE_API_URL}. Since there's no payment credential yet, the server should respond with HTTP 402 and a WWW-Authenticate header containing the payment challenge.`,
    loading: 'Probing...',
    detail:
      "The agent decodes the challenge and extracts the **network_id**. This identifies the merchant's payment profile on the Stripe network — the agent needs it to request the right type of SPT credential.",
  },

  createSpend: {
    description: `Step 2: The agent calls \`spend-request create\` with credential_type "shared_payment_token", the network_id from the challenge, and the amount (${sptAmount}). Unlike the card flow, no merchant name/URL is needed — the network_id identifies the merchant.`,
    loading: 'Creating...',
  },

  approval: {
    description:
      'Step 3: Same approval flow — you review and approve the spend request. Once approved, Link issues an SPT that the agent can use to sign the payment challenge.',
    loading: 'Waiting for approval...',
    browserHint: 'Press [Enter] to open in browser',
  },

  mppPay: {
    description:
      'Step 4: Now `mpp pay` handles the rest automatically — it retrieves the SPT from the approved spend request, re-sends the original POST to the API, receives the 402 challenge again, signs it with the SPT, and retries with an Authorization header.',
    loading: 'Completing payment...',
    prompt: 'Press [Enter] to pay',
  },

  done: {
    success: 'Payment complete!',
    detail: `The ${sptAmount} donation went through entirely via API — no forms, no browser, just the agent and the merchant server.`,
  },
};

// ---------------------------------------------------------------------------
// Demo runner (menu + transitions)
// ---------------------------------------------------------------------------

export const DEMO_MENU = {
  title: 'Link CLI Demo',
  subtitle:
    'See how agents use Link to make secure payments on behalf of users.',
  question: 'Which flow would you like to demo?',
  hint: 'Use ↑↓ to select, [Enter] to confirm',

  options: [
    {
      key: 'card' as const,
      label: 'Virtual cards',
      description:
        'Get a one-time card number to fill into a checkout form, like an agent buying on a website.',
    },
    {
      key: 'spt' as const,
      label: 'Payment tokens (MPP)',
      description:
        'Pay a merchant via API using the Machine Payment Protocol — no browser, no forms.',
    },
    {
      key: 'both' as const,
      label: 'Both',
      description: 'Walk through both flows end-to-end.',
    },
  ],

  transition:
    "That was the virtual card flow — the agent got a temporary card and could fill it into any checkout form. Next, let's see a completely different approach: the **machine payment** flow, where the agent pays entirely via API with no browser or form involved.",
  transitionPrompt: 'Press [Enter] to continue to Flow 2',
};

// ---------------------------------------------------------------------------
// Onboard runner
// ---------------------------------------------------------------------------

export const ONBOARD = {
  title: 'Welcome to Link CLI',
  subtitle:
    'Link CLI lets agents make secure payments on behalf of users. This setup will get you ready to go.',

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
      'Add a debit or credit card',
      'Come back here and press [Enter] to retry',
    ],
    retryPrompt: 'Press [Enter] to retry',
  },

  appTip: {
    title: 'Tip: Get the Link app',
    description:
      "For the fastest way to approve spend requests, get the Link app on your phone. You'll get push notifications when an agent asks to spend — tap to approve or deny.",
    url: 'https://link.com/download',
  },
};
