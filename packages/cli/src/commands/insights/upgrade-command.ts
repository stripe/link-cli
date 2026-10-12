import type { InsightAuthorizationRemediation } from '@stripe/link-sdk';
import { SOURCE_ACTIONS } from '../../auth/types';
import {
  buildCommandContinuation,
  formatCommandSuggestion,
} from '../../utils/command-continuation';

const supportedSourceActions = new Set<string>(SOURCE_ACTIONS);

export function upgradeCommand(
  remediations: readonly (InsightAuthorizationRemediation | null | undefined)[],
  platform: NodeJS.Platform = process.platform,
): string | null {
  const scopes = new Set<string>();
  const actionsByType = new Map<string, Set<string>>();

  for (const remediation of remediations) {
    for (const scope of remediation?.scope ?? []) {
      for (const token of scope.trim().split(/\s+/)) {
        if (token) scopes.add(token);
      }
    }
    for (const detail of remediation?.authorization_details ?? []) {
      const actions = actionsByType.get(detail.type) ?? new Set<string>();
      for (const action of detail.actions) {
        if (action) actions.add(action);
      }
      actionsByType.set(detail.type, actions);
    }
  }

  const args = ['upgrade'];
  if (scopes.size > 0) args.push('--scope', [...scopes].join(' '));
  for (const [type, actions] of actionsByType) {
    if (actions.size === 0) continue;
    if (
      type === 'source' &&
      [...actions].every((action) => supportedSourceActions.has(action))
    ) {
      for (const action of actions) args.push('--source-actions', action);
    } else {
      args.push(
        '--authorization-detail',
        JSON.stringify({ type, actions: [...actions] }),
      );
    }
  }

  if (args.length === 1) return null;
  const continuation = buildCommandContinuation('auth', args, platform);
  return continuation.command !== undefined
    ? `link-cli ${continuation.command}`
    : formatCommandSuggestion(continuation);
}
