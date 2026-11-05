import type { NextAction, SpendRequest } from '@stripe/link-sdk';

/** Project only the action belonging to the request's current status. */
export function getSpendRequestNextAction(
  request: SpendRequest,
): NextAction | null {
  switch (request.status) {
    case 'requires_action':
      return request.status_details?.requires_action?.next_action ?? null;
    case 'failed':
      return request.status_details?.failed?.next_action ?? null;
    default:
      return null;
  }
}
