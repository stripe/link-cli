import type { SpendRequest } from '@stripe/link-sdk';

/** Poll only while the request remains in its original waiting state. */
export function shouldPollSpendRequest(
  request: SpendRequest,
  fromStatus: SpendRequest['status'] = request.status,
): boolean {
  if (request.status !== fromStatus) return false;

  return (
    request.status === 'created' ||
    request.status === 'pending_approval' ||
    (request.status === 'requires_action' &&
      request.status_details?.requires_action?.next_action?.resolution ===
        'auto_resume')
  );
}
