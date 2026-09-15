import type { NextConfig } from 'next';
import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_SERVER,
} from 'next/constants';

export default function config(phase: string): NextConfig {
  if (phase === PHASE_DEVELOPMENT_SERVER || phase === PHASE_PRODUCTION_SERVER) {
    for (const name of [
      'LINK_CLIENT_ID',
      'LINK_CLIENT_SECRET',
      'STRIPE_PUBLISHABLE_KEY',
    ]) {
      if (!process.env[name]?.trim()) {
        throw new Error(
          `${name} is required. Set it in the example's .env.local before starting the server.`,
        );
      }
    }
  }

  return {
    agentRules: false,
  };
}
