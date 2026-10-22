import type { Channel } from '../channels/index.ts';
import type { LinkCli } from '../link.ts';
import type { Observed } from '../seller.ts';
import { card } from './card.ts';
import { spt } from './spt.ts';

export type Verdict = {
  status: 'pending' | 'passed' | 'failed' | 'unverified';
  error?: string;
  next_steps?: string;
  [key: string]: unknown;
};

export type Validation = {
  // URL path segment and result id: <payment method>-<channel>-<scenario>.
  id: string;
  // How the agent reaches the seller.
  channel: Channel;
  product: { name: string; amount: number; ships: boolean };
  // When set, the seller refuses payment with this message instead of charging.
  rejection?: string;
  task: (url: string) => string;
  // Called on every poll until it returns a final status. `final` is set when
  // the run is ending; a still-pending verdict then becomes timed_out.
  evaluate: (
    context: { observed: Observed; link: LinkCli; since: number },
    final: boolean,
  ) => Promise<Verdict>;
};

export type Scenario = Omit<Validation, 'id' | 'channel'> & {
  name: string;
  channels: Channel[];
};

// Each supported channel gets its own independent task and result.
export const validations: Validation[] = Object.entries({ spt, card }).flatMap(
  ([method, scenarios]) =>
    scenarios.flatMap(({ name, channels, ...scenario }) =>
      channels.map((channel) => ({
        ...scenario,
        id: `${method}-${channel}-${name}`,
        channel,
      })),
    ),
);
