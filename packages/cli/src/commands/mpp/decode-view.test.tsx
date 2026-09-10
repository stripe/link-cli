import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { decodeStripeChallenge } from './decode';
import { DecodeChallengeView } from './decode-view';

const ESCAPE_PAYLOAD = '\x1b[2JEvil\rHidden';
const CLEAN_TEXT = 'EvilHidden';

function encodeRequest(request: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(request)).toString('base64');
}

describe('DecodeChallengeView', () => {
  it('renders no raw ANSI escapes for an attacker-controlled challenge', () => {
    // The challenge string is fully attacker-controlled. Sanitization happens
    // at the decode.ts boundary, so render the real decoded output rather than
    // a hand-built object.
    const header = [
      `Payment id="${ESCAPE_PAYLOAD}",`,
      `realm="${ESCAPE_PAYLOAD}",`,
      'method="stripe",',
      'intent="charge",',
      `request="${encodeRequest({
        amount: '1000',
        currency: 'usd',
        merchantName: ESCAPE_PAYLOAD,
        methodDetails: {
          networkId: 'net_001',
          paymentMethodTypes: ['card'],
        },
      })}"`,
    ].join(' ');

    const decoded = decodeStripeChallenge(header);
    const { lastFrame } = render(<DecodeChallengeView decoded={decoded} />);

    const frame = lastFrame() ?? '';
    expect(frame).toContain(CLEAN_TEXT);
    expect(frame).not.toContain('\x1b[2J');
    expect(frame).not.toContain('\r');
  });
});
