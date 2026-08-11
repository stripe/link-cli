import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useCallback } from 'react';
import { useAsyncAction } from '../../hooks/use-async-action';
import type { InspectResult } from './inspect';
import { runInspect } from './inspect';

interface InspectViewProps {
  url: string;
  timeoutMs?: number;
  onComplete: (result: InspectResult | null) => void;
}

export const InspectView: React.FC<InspectViewProps> = ({
  url,
  timeoutMs,
  onComplete,
}) => {
  const { exit } = useApp();
  const action = useCallback(
    () => runInspect(url, { timeoutMs }),
    [url, timeoutMs],
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
          <Spinner type="dots" /> Inspecting {url}...
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

  if (!data) return null;

  return (
    <Box flexDirection="column">
      <Text>
        Payment strategies for <Text bold>{data.hostname}</Text>:
      </Text>
      <Box flexDirection="column" marginTop={1} paddingX={2}>
        {data.strategies.map((strategy) => (
          <Box key={strategy.name} flexDirection="column" marginBottom={1}>
            <Text color={strategy.detected ? 'green' : 'gray'}>
              {strategy.detected ? '✓' : '✗'} {strategy.label}
            </Text>
            {strategy.evidence.map((line, i) => (
              <Text key={`${strategy.name}-${i}`} dimColor>
                {'    '}
                {line}
              </Text>
            ))}
          </Box>
        ))}
      </Box>
      <Text color="green">
        Recommendation: <Text bold>{data.recommendation.strategy}</Text>
      </Text>
      <Text>{data.recommendation.reason}</Text>
      <Box marginTop={1}>
        <Text dimColor>{data.recommendation.instruction}</Text>
      </Box>
    </Box>
  );
};
