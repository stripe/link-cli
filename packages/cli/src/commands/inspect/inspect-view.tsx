import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useCallback } from 'react';
import { useAsyncAction } from '../../hooks/use-async-action';
import { sanitizeText } from '../../utils/sanitize-text';
import { type InspectResult, runInspect } from './inspect';

interface InspectViewProps {
  url: string;
  timeoutMs?: number;
  userAgent?: string;
  onComplete: (result: InspectResult | null) => void;
}

// Render every API field, including future additions, without inserting advice.
export function formatInspectFields(value: unknown, indent = ''): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return `${indent}[]`;
    return value
      .map(
        (entry) => `${indent}-\n${formatInspectFields(entry, `${indent}  `)}`,
      )
      .join('\n');
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return `${indent}{}`;
    return entries
      .map(([key, entry]) => {
        const label = sanitizeText(key.replaceAll('_', ' '));
        return entry !== null && typeof entry === 'object'
          ? `${indent}${label}:\n${formatInspectFields(entry, `${indent}  `)}`
          : `${indent}${label}: ${formatInspectFields(entry)}`;
      })
      .join('\n');
  }
  return `${indent}${sanitizeText(String(value)).replaceAll('\n', `\n${indent}  `)}`;
}

export const InspectView: React.FC<InspectViewProps> = ({
  url,
  timeoutMs,
  userAgent,
  onComplete,
}) => {
  const { exit } = useApp();
  const action = useCallback(
    () => runInspect(url, { timeoutMs, userAgent }),
    [url, timeoutMs, userAgent],
  );
  const handleComplete = useCallback(
    (result: InspectResult | null) => {
      onComplete(result);
      exit();
    },
    [onComplete, exit],
  );
  const { status, data, error } = useAsyncAction(action, handleComplete);
  if (status === 'loading') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" /> Inspecting {sanitizeText(url)}...
        </Text>
      </Box>
    );
  }
  if (status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ Inspection failed</Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  }
  return data ? <Text>{formatInspectFields(data)}</Text> : null;
};
