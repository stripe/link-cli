import type { JsonValue } from '@stripe/link-sdk';

export const INVALID_AUTHORIZATION_DETAIL_MESSAGE =
  'authorization-detail must be valid JSON';

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
