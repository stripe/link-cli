import {
  type DecodedStripeChallenge,
  decodeMppChallenges,
} from '@stripe/link-sdk';
import { sanitizeDeep } from '../../utils/sanitize-text';

export type { DecodedStripeChallenge };

export function decodeStripeChallenge(
  challengeHeader: string,
): DecodedStripeChallenge {
  const [decoded] = decodeMppChallenges(challengeHeader);
  return sanitizeDeep(decoded);
}
