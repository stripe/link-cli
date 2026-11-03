import type { SourceAction } from '@/auth/types';
import type { JsonValue } from '@/types/index';

function dedupe<T>(values: readonly T[]): T[] {
  const seen = new Set<T>();
  const result: T[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    result.push(value);
  }

  return result;
}

export function buildAuthorizationDetails(
  sourceActions: readonly SourceAction[] | undefined,
  authorizationDetails: readonly JsonValue[] | undefined,
): JsonValue[] {
  const details: JsonValue[] = [];
  const uniqueSourceActions = dedupe(sourceActions ?? []);

  if (uniqueSourceActions.length > 0) {
    details.push({
      type: 'source',
      actions: uniqueSourceActions,
    });
  }

  if (authorizationDetails) {
    details.push(...authorizationDetails);
  }

  return details;
}
