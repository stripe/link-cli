import stripAnsi from 'strip-ansi';

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally matching control characters for sanitization
const CONTROL_CHAR_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\r]/g;

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally matching control characters for detection
const NEEDS_SANITIZE_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\r\x1b]/;

export function sanitizeText(input: string | undefined | null): string {
  if (!input) {
    return '';
  }

  if (!NEEDS_SANITIZE_RE.test(input)) {
    return input;
  }

  return stripAnsi(input).replace(CONTROL_CHAR_RE, '');
}

export function sanitizeDeep<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return sanitizeText(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeDeep) as T;
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    const keys = Object.keys(value);

    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      result[k] = sanitizeDeep((value as Record<string, unknown>)[k]);
    }

    return result as T;
  }

  return value;
}
