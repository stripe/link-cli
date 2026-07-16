import type { SourceAction } from '@stripe/link-sdk';
import type { JsonValue } from './types';

export const INVALID_AUTHORIZATION_DETAIL_MESSAGE =
  'authorization-detail must be valid JSON';

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

export function parseAuthorizationDetails(
  entries: readonly string[] | undefined,
): JsonValue[] {
  const parsed: JsonValue[] = [];

  for (const entry of entries ?? []) {
    try {
      parsed.push(JSON.parse(entry) as JsonValue);
    } catch {
      throw new Error(INVALID_AUTHORIZATION_DETAIL_MESSAGE);
    }
  }

  return parsed;
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
