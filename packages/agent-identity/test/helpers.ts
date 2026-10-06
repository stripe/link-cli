/**
 * Test-only helpers.
 *
 * `firstFailure` exists because `result.failures[0]` is an unchecked index
 * access, and asserting through it in every test would either need a cast per
 * call site or would silently pass `undefined` into a comparison.
 */
import assert from 'node:assert/strict';
import type { Failure } from '../src/types.js';

export function firstFailure(result: {
  valid: boolean;
  failures?: readonly Failure[];
}): Failure {
  assert.equal(result.valid, false, 'expected the result to be a failure');
  const failures = result.failures;
  assert.ok(
    failures !== undefined && failures.length > 0,
    'expected at least one failure',
  );
  return failures[0] as Failure;
}

/** Asserts the result failed with exactly this code, and returns the failure. */
export function assertFailed(
  result: { valid: boolean; failures?: readonly Failure[] },
  code: Failure['code'],
): Failure {
  const failure = firstFailure(result);
  assert.equal(
    failure.code,
    code,
    `expected ${code}, got ${failure.code}: ${failure.message}`,
  );
  return failure;
}
