import { describe, expect, it } from 'vitest';
import { decodeStripeChallenge } from './decode';

function encodeRequest(request: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(request)).toString('base64');
}

describe('decodeStripeChallenge', () => {
  it('decodes a stripe charge challenge from a mixed WWW-Authenticate header', () => {
    const header = [
      'Bearer realm="merchant.example",',
      'Payment id="tempo_001", realm="merchant.example", method="tempo", intent="charge", request="e30=",',
      'Payment id="ch_001", realm="merchant.example", method="stripe", intent="charge",',
      `request="${encodeRequest({
        amount: '1000',
        currency: 'usd',
        methodDetails: {
          networkId: 'net_001',
          paymentMethodTypes: ['card'],
        },
      })}"`,
    ].join(' ');

    expect(decodeStripeChallenge(header)).toMatchObject({
      id: 'ch_001',
      realm: 'merchant.example',
      method: 'stripe',
      intent: 'charge',
      network_id: 'net_001',
      request_json: {
        methodDetails: {
          networkId: 'net_001',
        },
      },
    });
  });

  it('handles escaped quoted-string values in challenge parameters', () => {
    const header = [
      'Payment id="ch_001",',
      'realm="merchant.example",',
      'method="stripe",',
      'intent="charge",',
      'description="Plan \\"Pro\\", monthly",',
      `request="${encodeRequest({
        amount: '1000',
        currency: 'usd',
        methodDetails: {
          networkId: 'net_001',
          paymentMethodTypes: ['card'],
        },
      })}"`,
    ].join(' ');

    expect(decodeStripeChallenge(header)).toMatchObject({
      description: 'Plan "Pro", monthly',
      network_id: 'net_001',
    });
  });

  it('rejects headers without a stripe charge challenge', () => {
    const header =
      'Payment id="tempo_001", realm="merchant.example", method="tempo", intent="charge", request="e30="';

    expect(() => decodeStripeChallenge(header)).toThrow(/stripe charge/i);
  });

  it('rejects invalid stripe request payloads with a readable error', () => {
    const header = [
      'Payment id="ch_001",',
      'realm="merchant.example",',
      'method="stripe",',
      'intent="charge",',
      `request="${encodeRequest({
        amount: '1000',
        currency: 'usd',
        methodDetails: {
          paymentMethodTypes: ['card'],
        },
      })}"`,
    ].join(' ');

    expect(() => decodeStripeChallenge(header)).toThrow(
      /Invalid stripe challenge request: methodDetails\.networkId: missing/,
    );
  });

  it('accepts the live climate.stripe.dev stripe challenge shape', () => {
    const header = [
      'Payment id="gc2RV-_QuqyahPkrJPAmrVA4Iqam240ab6gGU4UmMXc", realm="climatestripe-d6929lvln.vercelapp.stripe.dev", method="tempo", intent="charge", request="eyJhbW91bnQiOiIxMDAwMDAwIiwiY3VycmVuY3kiOiIweDIwYzAwMDAwMDAwMDAwMDAwMDAwMDAwMGI5NTM3ZDExYzYwZThiNTAiLCJtZXRob2REZXRhaWxzIjp7ImNoYWluSWQiOjQyMTd9LCJyZWNpcGllbnQiOiIweDdiOWNhZTNjNmYzMzlkODY0YzdjNGNlZWVjOTcwM2M4NjRhNjhjOGIifQ", expires="2026-04-20T23:27:21.154Z",',
      'Payment id="ZcLbITjkJRIuYj1PPaHLi9b8OHqFS3DLyzRWRLupZGY", realm="climatestripe-d6929lvln.vercelapp.stripe.dev", method="stripe", intent="charge", request="eyJhbW91bnQiOiIxMDAiLCJjdXJyZW5jeSI6InVzZCIsIm1ldGhvZERldGFpbHMiOnsibmV0d29ya0lkIjoicHJvZmlsZV82MVUxV25hT1JRNWRBQThaekE2VTFXbmExWlNRVDJXQWVCYXd3cVVwYzBQMiIsInBheW1lbnRNZXRob2RUeXBlcyI6WyJjYXJkIiwibGluayJdfX0", description="Climate contribution", expires="2026-04-20T23:27:19.863Z"',
    ].join(' ');

    expect(decodeStripeChallenge(header)).toMatchObject({
      id: 'ZcLbITjkJRIuYj1PPaHLi9b8OHqFS3DLyzRWRLupZGY',
      network_id: 'profile_61U1WnaORQ5dAA8ZzA6U1Wna1ZSQT2WAeBawwqUpc0P2',
      request_json: {
        amount: '100',
        currency: 'usd',
        methodDetails: {
          networkId: 'profile_61U1WnaORQ5dAA8ZzA6U1Wna1ZSQT2WAeBawwqUpc0P2',
          paymentMethodTypes: ['card', 'link'],
        },
      },
    });
  });
});
