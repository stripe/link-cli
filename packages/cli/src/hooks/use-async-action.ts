import { useEffect, useRef, useState } from 'react';
import { DISPLAY_DELAY_MS } from '../utils/constants';

export type AsyncActionStatus = 'loading' | 'success' | 'error';

interface AsyncActionResult<T> {
  status: AsyncActionStatus;
  data: T | null;
  error: string;
}

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
        timeoutId = setTimeout(
          () => onCompleteRef.current(result),
          DISPLAY_DELAY_MS,
        );
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setStatus('error');
        timeoutId = setTimeout(
          () => onCompleteRef.current(null),
          DISPLAY_DELAY_MS,
        );
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
