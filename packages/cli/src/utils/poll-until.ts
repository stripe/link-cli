export interface PollUntilOptions<T> {
  /** Async function called each iteration to produce the next value. */
  fn: () => Promise<T>;
  /** Return true when the value represents a terminal state (stops polling). */
  isTerminal: (value: T) => boolean;
  /** Polling interval in seconds. If <= 0, runs once without looping. */
  interval: number;
  /** Maximum number of non-terminal iterations before stopping. 0 = unlimited. */
  maxAttempts: number;
  /** Timeout in seconds. Polling stops once this duration has elapsed. */
  timeout: number;
}

export interface PollUntilResult<T> {
  value: T;
  terminal: boolean;
  reason?: 'max_attempts' | 'timeout';
}

/**
 * Generic async generator that polls `fn` until `isTerminal` returns true,
 * max attempts are exhausted, or the timeout is reached.
 *
 * Yields intermediate results only when the JSON-serialized value changes
 * (to reduce noise in agent transcripts). The final yield always has
 * `terminal: true`. If polling stops due to limits, `reason` is set.
 */
export async function* pollUntil<T>(
  options: PollUntilOptions<T>,
): AsyncGenerator<PollUntilResult<T>> {
  const { fn, isTerminal, interval, timeout, maxAttempts } = options;
  const deadline = timeout ? Date.now() + timeout * 1000 : undefined;

  let attempts = 0;
  let previousSnapshot: string | undefined;

  while (true) {
    const value = await fn();

    if (isTerminal(value) || interval <= 0) {
      yield { value, terminal: true };
      return;
    }

    attempts++;

    const maxAttemptsExhausted = maxAttempts > 0 && attempts >= maxAttempts;
    const timeoutReached = deadline !== undefined && Date.now() >= deadline;

    if (maxAttemptsExhausted) {
      yield { value, terminal: true, reason: 'max_attempts' };
      return;
    }
    if (timeoutReached) {
      yield { value, terminal: true, reason: 'timeout' };
      return;
    }

    // Only yield when the value has changed to avoid noisy agent transcripts
    const snapshot = JSON.stringify(value);
    if (snapshot !== previousSnapshot) {
      previousSnapshot = snapshot;
      yield { value, terminal: false };
    }

    await new Promise((resolve) => setTimeout(resolve, interval * 1000));
  }
}
