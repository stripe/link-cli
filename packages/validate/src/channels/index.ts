import type { ChannelContext } from '../seller.ts';
import { api } from './api.ts';
import { browser } from './browser.ts';
import { mpp } from './mpp.ts';
import { webmcp } from './webmcp.ts';

export type Channel = 'api' | 'webmcp' | 'mpp' | 'browser';

// One handler per payment channel: how the agent reaches the seller.
export const channels: Record<
  Channel,
  (context: ChannelContext) => Promise<void>
> = {
  api,
  webmcp,
  mpp,
  browser,
};
