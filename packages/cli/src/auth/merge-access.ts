// Computes the superset of requested and currently-granted access for
// `auth upgrade`: the union of scopes and of authorization_details. Action-based
// details (`{ type, actions }`, e.g. `source`) are unioned per type so no
// already-granted action is dropped; opaque details are preserved verbatim.
import { DEFAULT_SCOPE } from './scopes';
import type { JsonValue } from './types';

const DEFAULT_SCOPE_TOKENS = DEFAULT_SCOPE.split(' ');

export interface MergedAccess {
  mergedScope: string;
  mergedAuthorizationDetails: JsonValue[];
}

interface ComputeMergedAccessOptions {
  existingAuthorizationDetails?: readonly JsonValue[];
  existingScope?: string;
  requestedAuthorizationDetails?: readonly JsonValue[];
  requestedScope?: string;
}

// Dedupe while preserving first-seen order.
function dedupePreserveOrder<T>(values: readonly T[]): T[] {
  const seen = new Set<T>();
  const deduped: T[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    deduped.push(value);
  }

  return deduped;
}

// Concatenate then dedupe: `current` entries win their position over dupes.
function unionPreserveOrder<T>(
  current: readonly T[],
  additional: readonly T[],
): T[] {
  return dedupePreserveOrder([...current, ...additional]);
}

// Narrow a JsonValue to a plain object (not null, not an array).
function isRecord(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Safely read the string `type` field off an authorization detail, if present.
function getDetailType(detail: JsonValue): string | undefined {
  if (!isRecord(detail) || typeof detail.type !== 'string') {
    return undefined;
  }

  return detail.type;
}

// Return the value as a string[] only if it's an array of all strings, else null.
function getStringArray(value: JsonValue | undefined): string[] | null {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string')
  ) {
    return null;
  }

  return value as string[];
}

// Tokenize a scope string on whitespace OR commas. The token endpoint echoes
// scope back comma-delimited, so the currently-granted scope must tokenize the
// same way space-separated `--scope` input does. (User `--scope` input stays
// strictly space-separated via `normalizeScopeInput`; comma tolerance is
// isolated here.) Falls back to the default scope when empty so an unspecified
// request compares against the baseline the server would grant.
function scopeTokens(
  scope: string | undefined,
  fallbackToDefault: boolean,
): string[] {
  const tokens = (scope ?? '')
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);

  if (tokens.length > 0) {
    return tokens;
  }

  return fallbackToDefault ? [...DEFAULT_SCOPE_TOKENS] : [];
}

// Read the deduped `actions` array off a granted detail, or null if the detail
// doesn't fit the expected `{ type, actions }` shape (opaque detail).
function grantedActions(detail: JsonValue): string[] | null {
  if (!isRecord(detail)) {
    return null;
  }

  const actions = getStringArray(detail.actions);
  return actions ? dedupePreserveOrder(actions) : null;
}

// Merge requested access with the currently-granted access to produce the
// superset to request on `auth upgrade`. Scopes are unioned; action-based
// authorization details (`{ type, actions }`) are unioned per type so existing
// actions survive even when the same type is re-requested with different
// actions; opaque details are preserved verbatim.
export function computeMergedAccess({
  requestedScope,
  requestedAuthorizationDetails,
  existingScope,
  existingAuthorizationDetails,
}: ComputeMergedAccessOptions): MergedAccess {
  const requestedTokens = scopeTokens(requestedScope, true);
  const existingTokens = scopeTokens(existingScope, true);
  const missingScopes = existingTokens.filter(
    (token) => !requestedTokens.includes(token),
  );
  const mergedScope = unionPreserveOrder(requestedTokens, missingScopes).join(
    ' ',
  );

  // Union authorization details across requested + existing. Action-based
  // `{ type, actions }` details (e.g. `source`) are merged per type so the
  // request keeps ALL granted actions of a type — not just the ones
  // re-specified this run. (Requesting `source: [read_external_transactions]`
  // when the session already holds `source: [read_balances]` must request
  // both.) Opaque details (no `actions` array — e.g. `{ type, filters }`, or
  // non-objects) are preserved verbatim and de-duplicated. First-seen order is
  // preserved, with requested details ahead of existing-only ones.
  const actionsByType = new Map<string, string[]>();
  const seenOpaque = new Set<string>();
  const layout: Array<
    { kind: 'actions'; type: string } | { kind: 'opaque'; detail: JsonValue }
  > = [];

  const absorb = (details: readonly JsonValue[]) => {
    for (const detail of details) {
      const type = getDetailType(detail);
      const actions = grantedActions(detail);
      if (type && actions) {
        if (!actionsByType.has(type)) {
          layout.push({ kind: 'actions', type });
        }
        actionsByType.set(
          type,
          unionPreserveOrder(actionsByType.get(type) ?? [], actions),
        );
      } else {
        // Opaque/unparseable detail — preserve verbatim, de-duplicated.
        const key = JSON.stringify(detail);
        if (!seenOpaque.has(key)) {
          seenOpaque.add(key);
          layout.push({ kind: 'opaque', detail });
        }
      }
    }
  };

  absorb(requestedAuthorizationDetails ?? []);
  absorb(existingAuthorizationDetails ?? []);

  const mergedAuthorizationDetails = layout.map((entry) =>
    entry.kind === 'actions'
      ? { type: entry.type, actions: actionsByType.get(entry.type) ?? [] }
      : entry.detail,
  );

  return { mergedScope, mergedAuthorizationDetails };
}
