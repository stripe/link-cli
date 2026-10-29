import type { SpendRequest } from '@stripe/link-sdk';
import {
  buildCommandContinuation,
  type CommandContinuation,
} from './command-continuation';

interface SpendRequestContinuation {
  instruction: string;
  _next?: CommandContinuation & { until: string };
}

function buildPollContinuation(id: string) {
  return buildCommandContinuation('spend-request', [
    'retrieve',
    id,
    '--interval',
    '2',
    '--max-attempts',
    '300',
  ]);
}

export function buildApprovalContinuation(
  request: Pick<SpendRequest, 'id' | 'status' | 'approval_url'>,
) {
  return {
    instruction: [
      request.approval_url
        ? 'Present the approval_url to the user and ask them to approve in the Link app.'
        : undefined,
      'Invoke _next.argv directly without a shell to wait for a status change and inspect the returned status. Do not wait for the user to reply — start polling immediately.',
    ]
      .filter(Boolean)
      .join(' '),
    _next: {
      ...buildPollContinuation(request.id),
      until: `status changes from ${request.status}`,
    },
  };
}

export function buildRequiresActionContinuation(
  request: SpendRequest,
): SpendRequestContinuation {
  const nextAction = request.status_details?.requires_action?.next_action;
  const isAutoResume = nextAction?.resolution === 'auto_resume';
  const instruction = [
    `The spend request requires ${isAutoResume ? 'additional verification' : 'action'}${nextAction?.type ? ` (${nextAction.type})` : ''}.`,
    nextAction?.display_message,
    nextAction?.action_url
      ? `Present action_url (${nextAction.action_url}) to the user so they can complete it.`
      : 'Have the user complete it.',
  ];

  if (isAutoResume) {
    instruction.push(
      'Then invoke _next.argv directly without a shell to keep polling until the status changes. Do not create a new spend request — this one resumes automatically once verification is completed.',
    );
  } else if (
    nextAction?.resolution === 'create_new_spend_request' ||
    nextAction?.resolution === 'create_new_spend_request_after_completion'
  ) {
    instruction.push(
      'Once the action is completed, create a new spend request.',
    );
  }

  return {
    instruction: instruction.filter(Boolean).join(' '),
    _next: isAutoResume
      ? {
          ...buildPollContinuation(request.id),
          until: 'status changes from requires_action',
        }
      : undefined,
  };
}
