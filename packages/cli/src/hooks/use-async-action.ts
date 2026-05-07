import { useEffect, useState } from 'react';

export type AsyncActionStatus = 'loading' | 'success' | 'error';

interface AsyncActionResult<T> {
  status: AsyncActionStatus;
  data: T | null;
  error: string;
}

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

  useEffect(() => {
    const run = async () => {
      try {
        const result = await action();
        setData(result);
        setStatus('success');
        setTimeout(() => onComplete(result), 1500);
      } catch (err) {
        const message = (err as Error).message;
        setError(message);
        setStatus('error');
        setTimeout(() => onComplete(null), 1500);
      }
    };

    run();
  }, [action, onComplete]);

  return { status, data, error };
}
