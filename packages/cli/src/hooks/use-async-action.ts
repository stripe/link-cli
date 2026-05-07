import { useEffect, useRef, useState } from 'react';

export type AsyncActionStatus = 'loading' | 'success' | 'error';

interface AsyncActionResult<T> {
  status: AsyncActionStatus;
  data: T | null;
  error: string;
}

const DELAY = 1500;

/**
 * Runs an async action on mount, manages loading/success/error state,
 * and calls onComplete after a brief delay to allow the UI to render.
 */
export function useAsyncAction<T>(
  action: () => Promise<T>,
  onComplete: (result: T | null) => void,
): AsyncActionResult<T> {
  const [status, setStatus] = useState<AsyncActionStatus>('loading');
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string>('');

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const run = async () => {
      try {
        const result = await action();
        if (cancelled) return;
        setData(result);
        setStatus('success');
        timeoutId = setTimeout(() => onCompleteRef.current(result), DELAY);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setStatus('error');
        timeoutId = setTimeout(() => onCompleteRef.current(null), DELAY);
      }
    };

    run();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [action]);

  return { status, data, error };
}
