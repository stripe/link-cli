import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { sanitizeDeep } from '../../utils/sanitize-text';
import { DecodeChallengeView } from './decode-view';

const ESCAPE_PAYLOAD = '\x1b[2JEvil\rHidden';
const CLEAN_TEXT = 'EvilHidden';

describe('DecodeChallengeView', () => {
  it('renders no raw ANSI escapes for an attacker-controlled challenge', () => {
    const decoded = sanitizeDeep([
      {
        id: ESCAPE_PAYLOAD,
        realm: ESCAPE_PAYLOAD,
        method: 'stripe' as const,
        intent: 'charge' as const,
        description: ESCAPE_PAYLOAD,
        network_id: 'net_001',
        request_json: {
          amount: '1000',
          currency: 'usd',
          merchantName: ESCAPE_PAYLOAD,
        },
      },
    ]);
    const { lastFrame } = render(<DecodeChallengeView decoded={decoded} />);

    const frame = lastFrame() ?? '';
    expect(frame).toContain(CLEAN_TEXT);
    expect(frame).not.toContain('\x1b[2J');
    expect(frame).not.toContain('\r');
  });
});
