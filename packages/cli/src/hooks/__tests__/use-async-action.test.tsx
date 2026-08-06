import { Text } from 'ink';
import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useAsyncAction } from '../use-async-action';

function TestComponent({
  action,
  onComplete,
}: {
  action: () => Promise<unknown>;
  onComplete: (result: unknown) => void;
}) {
  const { status, error } = useAsyncAction(action, onComplete);
  if (status === 'error') return <Text>{error}</Text>;
  return <Text>loading</Text>;
}

describe('useAsyncAction', () => {
  it('surfaces Error message on failure', async () => {
    const { lastFrame } = render(
      <TestComponent
        action={() => Promise.reject(new Error('something went wrong'))}
        onComplete={() => {}}
      />,
    );

    await vi.waitFor(() => {
      expect(lastFrame()).toBe('something went wrong');
    });
  });

  it('JSON-stringifies a thrown plain object instead of producing [object Object]', async () => {
    const thrown = { code: 'NETWORK_ERROR', detail: 'timeout' };
    const { lastFrame } = render(
      <TestComponent
        action={() => Promise.reject(thrown)}
        onComplete={() => {}}
      />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).not.toBe('[object Object]');
      expect(frame).toBe(JSON.stringify(thrown));
    });
  });

});
