export const DEFAULT_SCOPES = [
  'userinfo:read',
  'payment_methods.agentic',
] as const;

export const DEFAULT_SCOPE = DEFAULT_SCOPES.join(' ');

function parseScopeTokens(scope: string): string[] {
  return scope.trim().split(/\s+/).filter(Boolean);
}

export function normalizeScopeInput(
  scope: string | undefined,
): string | undefined {
  if (scope === undefined) {
    return undefined;
  }

  const normalized = parseScopeTokens(scope);
  return normalized.length > 0 ? normalized.join(' ') : undefined;
}
