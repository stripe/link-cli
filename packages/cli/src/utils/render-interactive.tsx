import { render } from 'ink';
import type React from 'react';

/**
 * Renders an Ink component and returns a promise that resolves after the
 * component's render lifecycle completes (waitUntilExit).
 *
 * @param element - The React element to render
 * @param getResult - Called after the component exits to produce the resolved value.
 *                    If omitted, resolves with `undefined`.
 */
export async function renderInteractive<T>(
  element: React.ReactElement,
  getResult?: () => T | Promise<T>,
): Promise<T> {
  const { waitUntilExit } = render(element);
  await waitUntilExit();
  if (getResult) {
    return getResult();
  }
  return undefined as T;
}
